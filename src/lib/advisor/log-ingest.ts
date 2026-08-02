// T-155: AIアドバイザーの「未読ログ取り込み」の本体ロジック。
//
// 未読の面談ログ（MEETING txt・advisorIngestedAt IS NULL）を全件まとめて読み、
// 既存ダイジェストと統合した1本のダイジェストを Candidate.advisorLogDigest に上書き保存する。
// 調査: docs/survey_T-155_advisor_unread_log_ingest.md
//
// 設計の要点:
//  - 追記でも毎回作り直しでもなく「既存ダイジェスト + 未読分 → 統合して上書き」。
//    サイズが一定に保たれ、費用は今回の未読分のみで済む。
//  - ★fail-closed: AI生成 → ダイジェスト保存 → advisorIngestedAt 更新 → contextCache 破棄 の順。
//    AI呼び出しが失敗したら一切書き込まない（未読のまま残り、次回押下で再試行できる）。
//  - ★contextCache 破棄は必須要件。破棄しないと既存セッションは最大30分
//    （messages route の CACHE_TTL）古いコンテキストのまま会話が続く。
//  - AI は Anthropic（CLAUDE_MODEL_DEFAULT 定数参照）。Gemini は使わない。
//    txt の生読みなので OCR も発生しない。
//  - cache_control は付けない（ログ本文もダイジェストも非決定的テキスト＝罠#39）。

import { prisma } from "@/lib/prisma";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { CLAUDE_MODEL_DEFAULT } from "@/lib/claude";
import { recordAdvisorUsage } from "@/lib/advisor-usage";

/** Anthropic 呼び出しのタイムアウト。 */
const INGEST_TIMEOUT_MS = 120_000;

/**
 * 1ファイルあたりの入力上限（文字）。実測最大は 88,555 byte ≒ 31,600 字（T-155 調査 D-5'）
 * なので通常は切り詰めが発生しない。T-151 の MAX_LOG_CHARS と同じ発想の防波堤。
 */
const MAX_CHARS_PER_FILE = 40_000;

/**
 * 全ファイル合計の入力上限（文字）。実測の最悪ケース（1人4件・合計約37,000字）の2倍強。
 * 超えた分は新しいファイルを優先して残し、古い側から切り詰める。
 */
const MAX_TOTAL_CHARS = 80_000;

/**
 * ダイジェストの出力上限。
 * - プロンプトで「4,000字以内」を指示（実測: 面談は1人最大4回・合計約37,000字 → 約1/9 への
 *   圧縮なら要点が残る。context 全体の 20,000 字予算に対して 20% で、他セクションを圧迫しない）
 * - max_tokens は日本語≒1 token/字 + 余裕で 6,000
 */
const DIGEST_CHAR_LIMIT = 4_000;
const MAX_OUTPUT_TOKENS = 6_000;

const DIGEST_SYSTEM_PROMPT = `あなたは人材紹介会社のCA（キャリアアドバイザー）のアシスタントです。
求職者との面談ログを読み、以降のAIアドバイザーとの会話で参照する「面談内容ダイジェスト」を作成します。

# 入力
- 既存のダイジェスト（あれば）: 過去の面談ログから作成済みの要約
- 未読の面談ログ（1件以上）: ファイル名とアップロード日付き

# 出力の要件
- 既存ダイジェストと未読ログの内容を**統合した1本のダイジェスト**を出力する。
  既存ダイジェストの情報は、新しいログで明確に更新された場合を除き**削除しない**。
- 必ず含めること:
  - 希望条件・志向性（変化があれば「当初→現在」の形で変化が分かるように）
  - 転職活動の進捗（他社選考・応募状況・書類の準備状況）
  - CAと求職者の間で交わされた約束・次のアクション
  - 面談で語られた重要なエピソード・事実（経歴の背景、家庭事情、性格特性など）
- **どの面談（日付）での発言かが分かるように**、項目に日付を添える（例: 「（7/28面談）」）。
- 見出し・箇条書きで構造化する。
- **全体で${DIGEST_CHAR_LIMIT}字以内**に収める。超えそうな場合は古い面談の詳細から圧縮する
  （ただし約束・進捗・希望条件の現在値は必ず残す）。
- ダイジェスト本文のみを出力する。前置きや説明は書かない。`;

export type IngestResult =
  | {
      ok: true;
      ingested: number;
      digestChars: number;
      fileNames: string[];
      truncated: boolean;
    }
  | { ok: false; error: string; status: number };

/**
 * 未読ログを取り込む。対象0件は ok:true / ingested:0 で返す（エラーにしない）。
 */
export async function ingestUnreadLogs(params: {
  candidateId: string;
}): Promise<IngestResult> {
  const { candidateId } = params;

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, name: true, advisorLogDigest: true },
  });
  if (!candidate) return { ok: false, error: "求職者が見つかりません", status: 404 };

  // 未読の MEETING txt（interview_id の有無は不問・全件）。古い順に読ませて時系列を保つ。
  const unread = await prisma.candidateFile.findMany({
    where: {
      candidateId,
      category: "MEETING",
      archivedAt: null,
      advisorIngestedAt: null,
      driveFileId: { not: null },
      OR: [
        { mimeType: { startsWith: "text/" } },
        { fileName: { endsWith: ".txt", mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, fileName: true, driveFileId: true, createdAt: true },
  });

  if (unread.length === 0) {
    return { ok: true, ingested: 0, digestChars: 0, fileNames: [], truncated: false };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY が未設定です", status: 500 };

  // ---- Drive からログ本文を取得（読み取りのみ） ----
  const logs: { id: string; fileName: string; dateJst: string; text: string }[] = [];
  for (const f of unread) {
    try {
      const { base64 } = await downloadFileFromDrive(f.driveFileId!);
      let text = Buffer.from(base64, "base64").toString("utf-8");
      if (text.length > MAX_CHARS_PER_FILE) {
        console.warn(
          `[advisor-log-ingest] truncate file ${f.fileName}: ${text.length} -> ${MAX_CHARS_PER_FILE} chars`,
        );
        text = text.slice(0, MAX_CHARS_PER_FILE);
      }
      logs.push({
        id: f.id,
        fileName: f.fileName,
        // 罠#17: JST の日付文字列は sv-SE + Asia/Tokyo で作る
        dateJst: new Date(f.createdAt).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
        text,
      });
    } catch (e) {
      // 1件でも読めないファイルがあれば中断（部分取り込みでフラグ状態が複雑になるのを避ける）。
      console.error(`[advisor-log-ingest] Drive download failed: ${f.fileName}`, e);
      return { ok: false, error: `面談ログのダウンロードに失敗しました（${f.fileName}）`, status: 500 };
    }
  }

  // 合計上限ガード: 新しいファイルを優先して残し、古い側から切り詰める。
  let total = logs.reduce((s, l) => s + l.text.length, 0);
  let truncated = false;
  for (const l of logs) {
    if (total <= MAX_TOTAL_CHARS) break;
    const cut = Math.min(l.text.length, total - MAX_TOTAL_CHARS);
    if (cut > 0) {
      console.warn(`[advisor-log-ingest] total-cap truncate ${l.fileName}: -${cut} chars`);
      l.text = l.text.slice(0, l.text.length - cut) || "（合計上限により省略）";
      total -= cut;
      truncated = true;
    }
  }

  // ---- プロンプト組み立て ----
  const existing = (candidate.advisorLogDigest ?? "").trim();
  let userContent = "";
  if (existing) {
    userContent += `## 既存のダイジェスト\n${existing}\n\n`;
  } else {
    userContent += `## 既存のダイジェスト\n（まだありません。今回が初回の取り込みです）\n\n`;
  }
  userContent += `## 未読の面談ログ（${logs.length}件・古い順）\n\n`;
  for (const l of logs) {
    userContent += `### ${l.fileName}（アップロード日: ${l.dateJst}）\n${l.text}\n\n`;
  }

  // ---- Anthropic 呼び出し（fail-closed: 失敗したら一切書き込まない） ----
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), INGEST_TIMEOUT_MS);
  let digest: string;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL_DEFAULT,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        system: DIGEST_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("[advisor-log-ingest] Anthropic API error:", response.status, errText.slice(0, 300));
      await recordAdvisorUsage({
        endpoint: "advisor-log-ingest",
        model: CLAUDE_MODEL_DEFAULT,
        usage: null,
        candidateId,
        note: `error-${response.status}`,
      });
      return { ok: false, error: "ダイジェストの生成に失敗しました。時間をおいて再度お試しください。", status: 502 };
    }

    const data = await response.json();
    await recordAdvisorUsage({
      endpoint: "advisor-log-ingest",
      model: CLAUDE_MODEL_DEFAULT,
      usage: data.usage ?? null,
      candidateId,
      note: `files-${logs.length};chars-${total}`,
    });
    digest = (data.content?.[0]?.text ?? "").trim();
    if (!digest) {
      return { ok: false, error: "ダイジェストの生成結果が空でした。再度お試しください。", status: 502 };
    }
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === "AbortError") {
      console.error("[advisor-log-ingest] timeout after", INGEST_TIMEOUT_MS, "ms");
      return { ok: false, error: "ダイジェストの生成がタイムアウトしました。再度お試しください。", status: 504 };
    }
    console.error("[advisor-log-ingest] failed:", e);
    return { ok: false, error: "ダイジェストの生成に失敗しました。", status: 500 };
  }

  // ---- 保存 → フラグ → キャッシュ破棄（トランザクションで原子化） ----
  // ★contextCache 破棄は必須要件: 破棄しないと既存セッションは最大30分古い情報のまま。
  await prisma.$transaction([
    prisma.candidate.update({
      where: { id: candidateId },
      data: { advisorLogDigest: digest, advisorLogDigestUpdatedAt: new Date() },
    }),
    prisma.candidateFile.updateMany({
      where: { id: { in: logs.map((l) => l.id) } },
      data: { advisorIngestedAt: new Date() },
    }),
    prisma.advisorChatSession.updateMany({
      where: { candidateId },
      data: { contextCache: null, contextCachedAt: null },
    }),
  ]);

  console.log(
    `[advisor-log-ingest] candidate=${candidateId} ingested=${logs.length} digestChars=${digest.length} truncated=${truncated}`,
  );

  return {
    ok: true,
    ingested: logs.length,
    digestChars: digest.length,
    fileNames: logs.map((l) => l.fileName),
    truncated,
  };
}
