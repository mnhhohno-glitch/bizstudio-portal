// T-205: 面談準備チャットの材料＝マイナビレジュメの文字（AI を使わない）。
//
// - 対象: その求職者の CandidateFile のうち category=MEETING かつ memo=「マイナビRPA自動取り込み」の PDF。
//   複数あれば最新1件（createdAt 降順）。MEETING には面談ログ txt 等も入るため、レジュメを確実に特定できるのは
//   memo だけ（docs/survey_T-XXX_advisor-cost-and-resume.md §3-2）。
// - 文字の取り出しは Drive からの取得＋ extractTextFromPdf（pdf-parse → 短ければ pdfjs-dist）。Gemini は使わない
//   （既存の parsedText は AI 読み取りの結果で途中で切れる例があるため使わず、書き込みもしない）。
// - 整形は毎回同じ結果になる処理だけ（罠#39: キャッシュは byte 一致が条件）。
import { prisma } from "@/lib/prisma";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { extractTextFromPdf } from "@/lib/ai/extract-text";

export const MYNAVI_RESUME_MEMO = "マイナビRPA自動取り込み";
/** これ未満しか取り出せなかったら「文字を読み取れない」扱い（AI は呼ばない）。 */
export const MIN_RESUME_CHARS = 200;
/** system に載せる上限。実物は 500〜2,400 字なので通常は届かない（暴走防止の上限）。 */
export const MAX_RESUME_CHARS = 20000;

export type MynaviResumeFile = {
  id: string;
  driveFileId: string | null;
  createdAt: Date;
};

/** 最新のマイナビレジュメ（RPA 取り込み PDF）を1件返す。無ければ null。 */
export async function findLatestMynaviResume(candidateId: string): Promise<MynaviResumeFile | null> {
  return prisma.candidateFile.findFirst({
    where: {
      candidateId,
      category: "MEETING",
      memo: MYNAVI_RESUME_MEMO,
      mimeType: "application/pdf",
      archivedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, driveFileId: true, createdAt: true },
  });
}

/**
 * 決定的な整形（同じ入力なら必ず同じ出力）。
 * 改行コードを LF に、行内の空白（全角含む）の連続を1つに、行頭行末の空白を除去、空行の連続を1つに。
 */
export function normalizeResumeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t　]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type ResumeExtractResult =
  | { ok: true; text: string; chars: number }
  | { ok: false; reason: "no_drive_file" | "too_short" | "download_failed"; chars: number };

/** Drive から PDF を取得して文字を取り出す（AI 不使用）。200字未満は失敗扱い。 */
export async function extractResumeText(file: MynaviResumeFile): Promise<ResumeExtractResult> {
  if (!file.driveFileId) return { ok: false, reason: "no_drive_file", chars: 0 };
  let buffer: Buffer;
  try {
    const { base64 } = await downloadFileFromDrive(file.driveFileId);
    buffer = Buffer.from(base64, "base64");
  } catch (e) {
    console.error("[interview-prep] resume download failed:", e instanceof Error ? e.message : e);
    return { ok: false, reason: "download_failed", chars: 0 };
  }
  const raw = await extractTextFromPdf(buffer);
  let text = normalizeResumeText(raw ?? "");
  if (text.length > MAX_RESUME_CHARS) text = text.slice(0, MAX_RESUME_CHARS);
  if (text.length < MIN_RESUME_CHARS) return { ok: false, reason: "too_short", chars: text.length };
  return { ok: true, text, chars: text.length };
}
