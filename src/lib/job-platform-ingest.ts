// T-131 step2: portal → job-platform 単発PDF投入クライアント。
// CAが手動アップした求人票PDF（sourceType=NULL のブックマーク）を job-platform の
// 内部投入API（POST /api/internal/ingest-pdf）へ送り、非公開求人としてフルデータ化する。
// 成功したら CandidateFile.externalJobRef に job-platform の sourceJobId を書き戻す。
//
// API仕様の正: job-platform docs/reports/T-131-step1-jobplatform.md
//   - 認証ヘッダ: X-Internal-Key（env INTERNAL_INGEST_API_KEY・fail-closed）
//   - body(multipart): file / media / ref
//   - 200 { sourceJobId, status, deduped, confidence, durationMs } / 422 { error, status:'error' }
//   - 処理時間 実測 約41秒/件（Gemini構造化が律速）
import { prisma } from "@/lib/prisma";

// job-platform（Vercel）の安定本番URL。env で上書き可能。
const JOB_PLATFORM_INGEST_BASE =
  process.env.JOB_PLATFORM_INGEST_URL ?? "https://bizstudio-job-platform.vercel.app";
// 処理実測41秒/件のため、既定fetchタイムアウトでは切れる。90秒以上を明示（余裕を持って120秒）。
const INGEST_TIMEOUT_MS = 120_000;

/**
 * ファイル名から媒体コードを推定する。
 * 判定順（先勝ち）:
 *   1. circus: ファイル名に「No」+ 5〜7桁（例: 株式会社エスプール_No319877.pdf）
 *   2. mynavi_jobshare: 先頭が4〜6桁数字＋アンダースコア（例: 33636_株式会社富士薬品_….pdf）
 *   3. own: 上記いずれにも該当しない（自社扱い）
 */
export function detectMediaFromFilename(fileName: string): "circus" | "mynavi_jobshare" | "own" {
  const f = fileName ?? "";
  if (/No\d{5,7}/i.test(f)) return "circus";
  if (/^\d{4,6}_/.test(f)) return "mynavi_jobshare";
  return "own";
}

export type IngestResult =
  | { ok: true; sourceJobId: string; status: string; deduped: boolean }
  | { ok: false; error: string };

/**
 * PDFを job-platform の内部投入APIへ送る（HTTPのみ・DB書込なし）。
 * INTERNAL_INGEST_API_KEY 未設定なら fail-closed（送らずエラーを返す）。
 */
export async function submitPdfToJobPlatform(args: {
  fileId: string;
  fileName: string;
  pdfBuffer: Buffer;
}): Promise<IngestResult> {
  const key = process.env.INTERNAL_INGEST_API_KEY;
  if (!key || key.trim() === "") {
    return { ok: false, error: "INTERNAL_INGEST_API_KEY 未設定（fail-closed）" };
  }
  const media = detectMediaFromFilename(args.fileName);
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(args.pdfBuffer)], { type: "application/pdf" }),
    args.fileName,
  );
  form.append("media", media);
  form.append("ref", args.fileId); // 相関ID: portal の CandidateFile ID

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INGEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${JOB_PLATFORM_INGEST_BASE}/api/internal/ingest-pdf`, {
      method: "POST",
      headers: { "x-internal-key": key },
      body: form,
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as {
      sourceJobId?: string;
      status?: string;
      deduped?: boolean;
      error?: string;
    };
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${json.error ?? JSON.stringify(json)}` };
    }
    if (!json.sourceJobId) {
      return { ok: false, error: `sourceJobId欠落: ${JSON.stringify(json)}` };
    }
    return {
      ok: true,
      sourceJobId: json.sourceJobId,
      status: json.status ?? "unknown",
      deduped: !!json.deduped,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 投入 → 成功なら CandidateFile に externalJobRef / platformSubmittedAt を書き戻す。
 * fire-and-forget から呼ぶ想定（例外は内部で握り潰し、呼び出し側フローを壊さない）。
 *
 * platformSubmittedAt は「試行時刻」を記録する:
 *   - 成功: externalJobRef=sourceJobId ＋ platformSubmittedAt=now（紐付け完了）
 *   - 失敗: platformSubmittedAt=now のみ（externalJobRef は null のまま＝拾い直しの再試行間隔ゲート）
 */
export async function ingestAndLink(args: {
  fileId: string;
  fileName: string;
  pdfBuffer: Buffer;
}): Promise<IngestResult> {
  let result: IngestResult;
  try {
    result = await submitPdfToJobPlatform(args);
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  try {
    if (result.ok) {
      await prisma.candidateFile.update({
        where: { id: args.fileId },
        data: { externalJobRef: result.sourceJobId, platformSubmittedAt: new Date() },
      });
      console.log(
        `[t131-ingest] 投入成功 fileId=${args.fileId} file=${args.fileName} → ${result.sourceJobId} (status=${result.status} deduped=${result.deduped})`,
      );
    } else {
      await prisma.candidateFile.update({
        where: { id: args.fileId },
        data: { platformSubmittedAt: new Date() },
      });
      console.error(
        `[t131-ingest] 投入失敗 fileId=${args.fileId} file=${args.fileName}: ${result.error}`,
      );
    }
  } catch (e) {
    // DB書き戻し失敗も既存フローは壊さない（次回の拾い直しで復旧）
    console.error(`[t131-ingest] 書き戻し失敗 fileId=${args.fileId}:`, e);
  }
  return result;
}
