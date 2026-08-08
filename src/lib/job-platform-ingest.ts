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
  // skipped=true: 送信前クレームに敗れた（他プロセスが既にクレーム済み＝二重発火の排他）。エラーではない。
  | { ok: false; error: string; skipped?: boolean };

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
 * 投入 → 成功なら CandidateFile に externalJobRef を書き戻す。
 * fire-and-forget から呼ぶ想定（例外は内部で握り潰し、呼び出し側フローを壊さない）。
 *
 * FU-8恒久修正（投入前クレーム方式）:
 *   `platformSubmittedAt` のセマンティクスは「投入クレーム時刻（=試行開始時刻）」。**HTTP送信の前に**
 *   `platformSubmittedAt IS NULL` の行に対してのみ now を打ち（クレーム）、更新0件ならその行の投入を
 *   スキップする（他プロセスが既にクレーム済み＝二重発火の排他）。これにより:
 *     - 消失耐性: 送信前に痕跡（platformSubmittedAt）が残るため、送信中/直後のプロセス死でも
 *       「platformSubmittedAt あり・externalJobRef なし」の状態が残り、拾い直しの対象になる（at-least-once化）。
 *     - 二重発火の排他: 同一行への同時投入は先着1件だけがクレームでき、残りはスキップ。
 *   成功時は externalJobRef=sourceJobId を書き戻す。失敗時はクレーム時刻をそのまま残す
 *   （externalJobRef=null のまま＝拾い直しの30分ゲートがクレーム時刻基準で効く）。
 *   ※既存データ（旧「試行後に打つ」方式で書かれた行）への遡及書き換えはしない。
 */
export async function ingestAndLink(args: {
  fileId: string;
  fileName: string;
  pdfBuffer: Buffer;
}): Promise<IngestResult> {
  // --- 投入前クレーム（送信前に platformSubmittedAt を打つ） ---
  const claimedAt = new Date();
  let claimCount: number;
  try {
    const claim = await prisma.candidateFile.updateMany({
      // platformSubmittedAt IS NULL（未クレーム）かつ externalJobRef IS NULL（未紐付け）の行だけをクレーム。
      // externalJobRef ガードは防御的（呼び出し側も未紐付けのみ渡すが、既に紐付いた行の再送信を機械的に防ぐ）。
      where: { id: args.fileId, platformSubmittedAt: null, externalJobRef: null },
      data: { platformSubmittedAt: claimedAt },
    });
    claimCount = claim.count;
  } catch (e) {
    console.error(`[t131-ingest] クレーム更新に失敗 fileId=${args.fileId}:`, e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (claimCount === 0) {
    // 他プロセスが既にクレーム済み（＝二重発火）。送信せずスキップ（job-platform に重複を作らない）。
    console.log(`[t131-ingest] 既にクレーム済みのため投入をスキップ fileId=${args.fileId} file=${args.fileName}`);
    return { ok: false, error: "already-claimed (skipped)", skipped: true };
  }

  // --- 送信（クレーム済みなので途中で死んでも痕跡が残る＝拾い直しで復旧） ---
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
      // 失敗: platformSubmittedAt はクレームで既に now。追加更新は不要（30分ゲートはクレーム時刻基準）。
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
