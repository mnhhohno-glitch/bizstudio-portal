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
//
// T-XXX（2026-09-28・両側の取り決め）: 返却に次の任意項目が追加される。ポータルはこれを正として保存する。
//   - sourceMedia: job-platform の媒体コード（source_media の値そのまま。例 "hito_link"）
//   - sourceJobId: job-platform の番号（DBNO。本文の「求人ID：hl-ap-…」を最優先で job-platform が決める）
//   - jobArea / jobCategory / jobCategoryPath: T-200 と同じ形。職種が取れないときは3つとも付かない
//   返却に sourceMedia が無い（相手側が未反映）ときは、本文の求人ID → ファイル名の順で予備判定する
//   （resolveFallbackMedia）。送信時の media はこれまでどおりファイル名判定（旧受け口に "hito_link" を
//   送ると hito_link-xxxxxx の番号で日次取り込み用の媒体に混入するため変えない）。
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

// HITO-Link 求人票PDFの本文にある求人ID行（例「求人ID：hl-ap-207786」）。全角/半角コロン・空白許容。
const HITO_LINK_TEXT_JOB_ID_RE = /求人ID[：:]\s*(hl-ap-\d+)/;
// HITO-Link の現在のダウンロード名: 求人票_{会社名}_{17桁の日時}.pdf（本番実データ 3,124件中 3,101件が本文に hl-ap を持つ。
// circus の No\d{5,7} / マイナビの ^\d{4,6}_ との誤マッチは実データ照合で 0 件）。
const HITO_LINK_FILENAME_RE = /^求人票_.+_\d{17}\.pdf$/i;

/**
 * T-XXX: 返却に sourceMedia が無いときの予備判定（保存用）。
 *   1. 抽出済み本文に「求人ID：hl-ap-\d+」があれば hito_link
 *   2. ファイル名が HITO-Link の現在のダウンロード名（求人票_{会社名}_{17桁}.pdf）なら hito_link
 *   3. それ以外は従来の detectMediaFromFilename（circus / mynavi_jobshare / own）
 * ※送信時の media には使わない（上記ヘッダ参照）。
 */
export function resolveFallbackMedia(args: {
  fileName: string;
  extractedText?: string | null;
}): "hito_link" | "circus" | "mynavi_jobshare" | "own" {
  if (args.extractedText && HITO_LINK_TEXT_JOB_ID_RE.test(args.extractedText)) return "hito_link";
  if (HITO_LINK_FILENAME_RE.test(args.fileName ?? "")) return "hito_link";
  return detectMediaFromFilename(args.fileName);
}

/** 抽出済み本文から HITO-Link の求人ID（hl-ap-…）を取り出す。無ければ null。 */
export function extractHitoLinkJobIdFromText(extractedText: string | null | undefined): string | null {
  if (!extractedText) return null;
  const m = extractedText.match(HITO_LINK_TEXT_JOB_ID_RE);
  return m ? m[1] : null;
}

export type IngestResult =
  | {
      ok: true;
      sourceJobId: string;
      status: string;
      deduped: boolean;
      /** T-XXX: job-platform が本文から確定した媒体コード（未反映の相手側からは undefined） */
      sourceMedia?: string;
      /** T-XXX: T-200 と同じ形。3つ揃ったときだけ保存する（揃わなければ既存値を消さない） */
      jobArea?: string;
      jobCategory?: string;
      jobCategoryPath?: string;
    }
  // skipped=true: 送信前クレームに敗れた（他プロセスが既にクレーム済み＝二重発火の排他）。エラーではない。
  | { ok: false; error: string; skipped?: boolean };

/** 返却 JSON の任意文字列項目。空文字・非文字列は undefined（保存しない）。長すぎる値は切る（DB列は無制限だが表示用）。 */
function optStr(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.length > 500 ? t.slice(0, 500) : t;
}

/**
 * T-XXX: 投入成功時に CandidateFile へ書き戻すデータを組み立てる（ingestAndLink と resubmit-stale で共用）。
 *   - externalJobRef = 返却の sourceJobId（DBNO）
 *   - sourceMedia   = 返却の sourceMedia を正とし、無ければ予備判定（本文の求人ID → ファイル名）
 *   - jobArea / jobCategory / jobCategoryPath = 3つ揃ったときだけ保存（T-200 ルール。揃わなければ既存値を消さない）
 *   媒体が hito_link なら DB名列は SOURCE_MEDIA_TO_JOBDB で「HITO-Link」になる（エントリー化の jobDb も同じ関数）。
 */
export function buildLinkData(
  result: Extract<IngestResult, { ok: true }>,
  file: { fileName: string; extractedText?: string | null },
): {
  externalJobRef: string;
  platformSubmittedAt: Date;
  sourceMedia: string;
  jobArea?: string;
  jobCategory?: string;
  jobCategoryPath?: string;
} {
  const sourceMedia = result.sourceMedia ?? resolveFallbackMedia(file);
  const attrs =
    result.jobArea && result.jobCategory && result.jobCategoryPath
      ? { jobArea: result.jobArea, jobCategory: result.jobCategory, jobCategoryPath: result.jobCategoryPath }
      : {};
  return { externalJobRef: result.sourceJobId, platformSubmittedAt: new Date(), sourceMedia, ...attrs };
}

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
      sourceMedia?: unknown;
      jobArea?: unknown;
      jobCategory?: unknown;
      jobCategoryPath?: unknown;
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
      sourceMedia: optStr(json.sourceMedia),
      jobArea: optStr(json.jobArea),
      jobCategory: optStr(json.jobCategory),
      jobCategoryPath: optStr(json.jobCategoryPath),
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
  /** T-XXX: 予備の媒体判定用（返却に sourceMedia が無いとき本文の求人IDを見る）。無くても動く。 */
  extractedText?: string | null;
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
      const data = buildLinkData(result, { fileName: args.fileName, extractedText: args.extractedText });
      await prisma.candidateFile.update({ where: { id: args.fileId }, data });
      console.log(
        `[t131-ingest] 投入成功 fileId=${args.fileId} file=${args.fileName} → ${result.sourceJobId} (status=${result.status} deduped=${result.deduped} media=${data.sourceMedia}${data.jobArea ? ` area=${data.jobArea} category=${data.jobCategory}` : ""})`,
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
