// T-183 Phase 5: 面談サポートの事前情報（キャリアシート等）取得API。
// 面談レコード→求職者の添付ファイルから、ファイル名にキャリアシート/レジュメ/履歴書/職務経歴を含む
// PDF を自動選択し、テキストを抽出して返す。支援画面はこれを auto-scan の priorInfoText として使う。
// - 抽出は extractTextFromPdf（pdf-parse→pdfjs-dist。AI不使用＝費用ゼロ・数秒で完了）。
//   キャリアシートはテキスト入りPDF前提。抽出が MIN_PRIOR_TEXT_CHARS 未満ならスキャンPDFとみなし
//   「事前情報なし」扱い（available: false）。
// - T-164 の parsedText（AI解析の永続キャッシュ）が既にあればそれを使い、Driveダウンロードを省く。
//   ただしこのAPIから parsedText への書き込みはしない（advisor-context のAI解析パイプラインと混ぜない）。
// - 該当が複数あれば candidates に全件返し、支援画面がプルダウンで切り替えられるようにする
//   （?fileId= で明示指定）。1件なら自動採用。
// Phase 6: 抽出テキストから固有名詞リスト（keyterms）を Haiku で1回だけ作って返す。
//   支援画面はこれを Deepgram の Keyterm Prompting（listen の keyterm パラメータ）に渡し、
//   病院名・学校名・資格名等の音声認識精度を底上げする。抽出失敗時は keyterms 無しで続行。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { extractTextFromPdf } from "@/lib/ai/extract-text";
import { anthropic, CLAUDE_MODEL_FAST } from "@/lib/claude";
import { recordAdvisorUsage } from "@/lib/advisor-usage";

// Driveダウンロード＋PDF抽出で十数秒かかる大型ファイルに備える。
export const maxDuration = 60;

// これ未満しか抽出できないPDFはスキャン（画像）PDFとみなす。
const MIN_PRIOR_TEXT_CHARS = 200;
// auto-scan へ渡す上限。プロンプト肥大の防止（キャリアシートは冒頭にプロフィール・経歴が来る想定で先頭を残す）。
const MAX_PRIOR_TEXT_CHARS = 6000;

// ファイル名でキャリアシート系を判定するキーワード。複数該当時の自動選択はこの並び順を優先する。
const PRIOR_FILE_KEYWORDS = ["キャリアシート", "職務経歴", "レジュメ", "履歴書"] as const;

// 求人票系（BOOKMARK/JOB_POSTING）は対象外。添付タブ(MEETING)のほか、履歴書等が入りうる区分も見る。
const PRIOR_FILE_CATEGORIES = ["MEETING", "ORIGINAL", "BS_DOCUMENT", "APPLICATION"] as const;

function keywordRank(fileName: string): number {
  const idx = PRIOR_FILE_KEYWORDS.findIndex((k) => fileName.includes(k));
  return idx < 0 ? PRIOR_FILE_KEYWORDS.length : idx;
}

// Phase 6: Deepgram Keyterm Prompting 用の固有名詞リスト上限（URL長対策。クライアント側でも同値で防御）。
const MAX_KEYTERMS = 50;
const KEYTERM_MAX_TOKENS = 1000;

const KEYTERM_SYSTEM_PROMPT = `以下に渡すテキストは求職者のキャリアシート・職務経歴書です。音声認識エンジンの固有名詞辞書に使うため、テキストに出てくる固有名詞（会社名・病院名・施設名・学校名・資格名・職種名）だけを抽出してください。
出力は JSON の文字列配列のみ（例: ["○○病院","理学療法士"]）。前後に説明文・コードブロック記号を付けないこと。最大${MAX_KEYTERMS}語。一般的な単語・人名・地名単体は含めない。`;

/** 事前情報テキストから固有名詞リストを1回だけ抽出する。失敗は空配列（本体は止めない）。 */
async function extractKeyterms(priorText: string): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const startedAt = Date.now();
  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL_FAST,
      max_tokens: KEYTERM_MAX_TOKENS,
      system: KEYTERM_SYSTEM_PROMPT,
      messages: [{ role: "user", content: priorText }],
    });
    const raw = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    // 指示に反して前後に文字が付いた場合に備え、最初の [ から最後の ] を対象にする。
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start < 0 || end <= start) return [];
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    const keyterms = (Array.isArray(parsed) ? parsed : [])
      .filter((t): t is string => typeof t === "string" && t.trim() !== "")
      .map((t) => t.trim());
    const deduped = [...new Set(keyterms)].slice(0, MAX_KEYTERMS);

    // T-126: usage 永続化（失敗しても本体に影響しない）。
    await recordAdvisorUsage({
      endpoint: "interview-support-prior-keyterms",
      model: CLAUDE_MODEL_FAST,
      usage: message.usage,
      latencyMs: Date.now() - startedAt,
      note: `keyterms:${deduped.length}`,
    });
    return deduped;
  } catch (e) {
    console.error("[interview-support/prior-info] keyterm extraction failed:", e);
    return [];
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ interviewId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { interviewId } = await params;
  const record = await prisma.interviewRecord.findUnique({
    where: { id: interviewId },
    select: { candidateId: true },
  });
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });

  const files = await prisma.candidateFile.findMany({
    where: {
      candidateId: record.candidateId,
      category: { in: [...PRIOR_FILE_CATEGORIES] },
      mimeType: "application/pdf",
      driveFileId: { not: null },
      archivedAt: null,
      OR: PRIOR_FILE_KEYWORDS.map((k) => ({ fileName: { contains: k } })),
    },
    select: { id: true, fileName: true, driveFileId: true, parsedText: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  // 自動選択順: キーワード優先度（キャリアシート＞職務経歴＞レジュメ＞履歴書）→ 新しい順。
  const sorted = [...files].sort(
    (a, b) => keywordRank(a.fileName) - keywordRank(b.fileName) || b.createdAt.getTime() - a.createdAt.getTime()
  );
  const candidates = sorted.map((f) => ({ id: f.id, fileName: f.fileName }));

  if (sorted.length === 0) {
    return NextResponse.json({ available: false, candidates: [] });
  }

  const requestedFileId = req.nextUrl.searchParams.get("fileId");
  const selected = requestedFileId ? sorted.find((f) => f.id === requestedFileId) : sorted[0];
  if (!selected) {
    return NextResponse.json({ available: false, candidates });
  }

  try {
    // T-164 の解析済みキャッシュがあれば流用（Driveダウンロード不要・即応答）。
    let text = selected.parsedText?.trim() ?? "";
    if (text.length < MIN_PRIOR_TEXT_CHARS) {
      const { base64 } = await downloadFileFromDrive(selected.driveFileId!);
      text = (await extractTextFromPdf(Buffer.from(base64, "base64"))).trim();
    }
    if (text.length < MIN_PRIOR_TEXT_CHARS) {
      // スキャンPDF等。候補一覧は返す（複数候補時にユーザーが別ファイルへ切り替えられるように）。
      return NextResponse.json({ available: false, candidates });
    }
    const trimmed = text.slice(0, MAX_PRIOR_TEXT_CHARS);
    // Phase 6: Deepgram Keyterm Prompting 用の固有名詞リスト（開始前の1回のみ・Haiku・失敗は空で続行）。
    const keyterms = await extractKeyterms(trimmed);
    return NextResponse.json({
      available: true,
      fileId: selected.id,
      fileName: selected.fileName,
      text: trimmed,
      keyterms,
      candidates,
    });
  } catch (e) {
    console.error("[interview-support/prior-info] extract failed:", { fileId: selected.id, error: e });
    // 事前情報は無くても面談サポート本体は動く。エラーでも available: false で穏やかに返す。
    return NextResponse.json({ available: false, candidates });
  }
}
