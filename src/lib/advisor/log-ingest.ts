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
//
// T-184: タイプ診断の経路からも同じ取り込みを行えるよう、部品を切り出して共有している。
//   collectUnreadLogs（未読判定＋全文取得＋入力ガード）/ buildDigestUserContent（入力の組み立て）/
//   DIGEST_RULES（要約の作り方）/ saveIngestedDigest（保存トランザクション）が共有点。
//   ボタン経路は「専用の1コール」、タイプ診断経路は「診断コールに同梱」で AI 呼び出しを増やさない。

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

/**
 * T-184: ダイジェストの作り方（入力の説明・統合ルール・書式・字数）。
 * 「未読ログ取込」ボタン（＝この下の DIGEST_SYSTEM_PROMPT）と、タイプ診断に同梱する
 * 追加タスク指示（buildInlineDigestInstruction）の**両方**がこの1本を参照する。
 * 文言を分けると2経路でダイジェストの品質・書式がずれるため、単一情報源にしている。
 */
const DIGEST_RULES = `# 入力
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
  （ただし約束・進捗・希望条件の現在値は必ず残す）。`;

const DIGEST_SYSTEM_PROMPT = `あなたは人材紹介会社のCA（キャリアアドバイザー）のアシスタントです。
求職者との面談ログを読み、以降のAIアドバイザーとの会話で参照する「面談内容ダイジェスト」を作成します。

${DIGEST_RULES}
- ダイジェスト本文のみを出力する。前置きや説明は書かない。`;

/**
 * T-184: タイプ診断の応答にダイジェストを同梱させるときの区切り文字。
 * 応答から抽出したあと本文からは必ず除去する（画面・DB・返却のいずれにも残さない）。
 */
export const LOG_DIGEST_START = "<<<LOG_DIGEST>>>";
export const LOG_DIGEST_END = "<<<END_LOG_DIGEST>>>";

export type IngestResult =
  | {
      ok: true;
      ingested: number;
      digestChars: number;
      fileNames: string[];
      truncated: boolean;
    }
  | { ok: false; error: string; status: number };

export type UnreadLog = {
  id: string;
  fileName: string;
  /** JST の日付文字列（罠#17: toISOString().slice は使わない）。 */
  dateJst: string;
  text: string;
};

export type UnreadLogBundle = {
  logs: UnreadLog[];
  /** 入力ガード適用後の合計文字数。 */
  totalChars: number;
  truncated: boolean;
  /** 既存の Candidate.advisorLogDigest（trim 済み・無ければ空文字）。 */
  existingDigest: string;
};

export type CollectUnreadLogsResult =
  | { ok: true; bundle: UnreadLogBundle }
  | { ok: false; error: string; status: number };

/**
 * 未読の面談ログを集める（DB検索 → Drive 全文取得 → 入力ガード）。読み取りのみで一切書き込まない。
 *
 * T-184: 「未読ログ取込」ボタンとタイプ診断の両方から呼ぶ。未読の判定条件・入力ガードを
 * 1箇所に閉じ込め、2経路で対象がずれないようにするための切り出し。
 * 対象0件は ok:true / logs 空配列で返す（エラーにしない）。
 */
export async function collectUnreadLogs(candidateId: string): Promise<CollectUnreadLogsResult> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, advisorLogDigest: true },
  });
  if (!candidate) return { ok: false, error: "求職者が見つかりません", status: 404 };

  const existingDigest = (candidate.advisorLogDigest ?? "").trim();

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
    return { ok: true, bundle: { logs: [], totalChars: 0, truncated: false, existingDigest } };
  }

  // ---- Drive からログ本文を取得（読み取りのみ） ----
  const logs: UnreadLog[] = [];
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
      return {
        ok: false,
        error: `面談ログのダウンロードに失敗しました（${f.fileName}）`,
        status: 500,
      };
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

  return { ok: true, bundle: { logs, totalChars: total, truncated, existingDigest } };
}

/**
 * ダイジェスト生成の入力（既存ダイジェスト + 未読ログ本文）を組み立てる。
 * DIGEST_RULES の「# 入力」節が説明している構造そのもの。2経路で同じ形にする。
 */
export function buildDigestUserContent(bundle: UnreadLogBundle): string {
  let userContent = "";
  if (bundle.existingDigest) {
    userContent += `## 既存のダイジェスト\n${bundle.existingDigest}\n\n`;
  } else {
    userContent += `## 既存のダイジェスト\n（まだありません。今回が初回の取り込みです）\n\n`;
  }
  userContent += `## 未読の面談ログ（${bundle.logs.length}件・古い順）\n\n`;
  for (const l of bundle.logs) {
    userContent += `### ${l.fileName}（アップロード日: ${l.dateJst}）\n${l.text}\n\n`;
  }
  return userContent;
}

/**
 * T-184: タイプ診断の応答末尾にダイジェストを同梱させる追加指示。
 * 診断プロンプトの**可変ブロック側**（ユーザーメッセージ）に連結する。
 * 固定ブロック（cache_control 付き）には絶対に入れない（罠#39）。
 */
export function buildInlineDigestInstruction(logCount: number): string {
  return `

---

# 【追加タスク】面談ログのダイジェスト作成

上に添えた未読の面談ログ（${logCount}件）を読み、回答の**いちばん最後**に
「面談内容ダイジェスト」を ${LOG_DIGEST_START} と ${LOG_DIGEST_END} で囲んで出力すること。

- このダイジェストはCAの画面には表示されない。以降のAIアドバイザーとの会話で参照するために保存される。
- 診断本文（タイプ診断・検索戦略）は従来どおりの内容・書式で書く。ダイジェスト用の説明を混ぜない。
- 区切り文字の外にダイジェストの内容を書かない。区切り文字は1回だけ使う。

${DIGEST_RULES}

出力形式（回答の末尾）:

${LOG_DIGEST_START}
（ダイジェスト本文）
${LOG_DIGEST_END}
`;
}

/**
 * 応答本文からダイジェストブロックを抜き出し、本文からは除去する。
 * 抽出できなければ digest:null（＝fail-closed の判定材料）。cleanContent は必ず返す。
 */
export function extractLogDigestBlock(aiContent: string): {
  cleanContent: string;
  digest: string | null;
} {
  if (!aiContent) return { cleanContent: aiContent, digest: null };

  const startIdx = aiContent.indexOf(LOG_DIGEST_START);
  if (startIdx < 0) return { cleanContent: aiContent, digest: null };

  const bodyStart = startIdx + LOG_DIGEST_START.length;
  const endIdx = aiContent.indexOf(LOG_DIGEST_END, bodyStart);
  // 終端が無い（出力途中で切れた等）ときは、開始マーカー以降をまるごと落とす。
  // 中途半端なダイジェストは保存しないが、マーカーが画面に出るのは必ず防ぐ。
  const digest = endIdx < 0 ? "" : aiContent.slice(bodyStart, endIdx).trim();
  const rest = endIdx < 0 ? "" : aiContent.slice(endIdx + LOG_DIGEST_END.length);
  const cleanContent = (aiContent.slice(0, startIdx) + rest).trimEnd();

  return { cleanContent, digest: digest || null };
}

/**
 * ダイジェスト保存 → 既読フラグ → contextCache 破棄（トランザクションで原子化）。
 *
 * ★contextCache 破棄は必須要件: 破棄しないと既存セッションは最大24時間（messages route の
 *   CACHE_TTL）古いコンテキストのまま会話が続く。
 */
export async function saveIngestedDigest(params: {
  candidateId: string;
  digest: string;
  fileIds: string[];
}): Promise<void> {
  const { candidateId, digest, fileIds } = params;
  const now = new Date();
  await prisma.$transaction([
    prisma.candidate.update({
      where: { id: candidateId },
      data: { advisorLogDigest: digest, advisorLogDigestUpdatedAt: now },
    }),
    prisma.candidateFile.updateMany({
      where: { id: { in: fileIds } },
      data: { advisorIngestedAt: now },
    }),
    prisma.advisorChatSession.updateMany({
      where: { candidateId },
      data: { contextCache: null, contextCachedAt: null },
    }),
  ]);
}

/**
 * 未読ログを取り込む。対象0件は ok:true / ingested:0 で返す（エラーにしない）。
 */
export async function ingestUnreadLogs(params: {
  candidateId: string;
}): Promise<IngestResult> {
  const { candidateId } = params;

  const collected = await collectUnreadLogs(candidateId);
  if (!collected.ok) return { ok: false, error: collected.error, status: collected.status };

  const { logs, totalChars: total, truncated } = collected.bundle;
  if (logs.length === 0) {
    return { ok: true, ingested: 0, digestChars: 0, fileNames: [], truncated: false };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY が未設定です", status: 500 };

  const userContent = buildDigestUserContent(collected.bundle);
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


  await saveIngestedDigest({ candidateId, digest, fileIds: logs.map((l) => l.id) });

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
