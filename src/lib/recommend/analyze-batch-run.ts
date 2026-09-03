// T-189 追加: AI評価バッチの「投入」「回収」の本体。
//
// 元は /api/internal/recommend/analyze-submit ・ /analyze-collect の route ハンドラ内に
// 直書きされていた処理をそのまま切り出したもの（ロジックは等価。差分は
// `candidateId` で対象を1人に絞れるオプションを足した点だけ）。
//
// 呼び出し元は2系統:
//   1. cron: /api/internal/recommend/analyze-submit・analyze-collect（candidateId なし＝全体対象）
//   2. 画面: /api/candidates/[candidateId]/recommend-now・recommend-collect（当該求職者のみ）
// どちらも同じ関数を通るため、無人経路と手動経路で評価内容がズレない。
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { anthropic, CLAUDE_MODEL_ANALYSIS } from "@/lib/claude";
import { buildAnalyzeBatchSystemBlocks } from "@/lib/analyze-batch-cache";
import {
  buildAnalyzeFixedSystem,
  buildBatchInstruction,
  buildAnalyzeCandidateContext,
  buildAnalyzeJobsSection,
  applyAnalysisResults,
} from "@/lib/analyze-bookmarks";
import { recordAdvisorUsage, type AnthropicUsage } from "@/lib/advisor-usage";
import { AUTO_REJECT_REASON_D } from "@/lib/recommend/auto-approval";
import { rejectAutoFiles } from "@/lib/recommend/auto-approval-sync";
import { AUTO_FILE_PDF_SELECT, generatePdfForAutoFile } from "@/lib/recommend/auto-approval-pdf";
import { randomUUID } from "crypto";

const BATCH_SIZE = 5; // CA画面（AdvisorFloatingPanel）の batchSize と同一
const DEFAULT_MAX_FILES = 200;
const BATCH_TIMEOUT_MS = 24 * 60 * 60 * 1000; // Anthropic Message Batches の期限（24h）
// T-189 修正: 回収の排他。複数の回収経路（定時cron / 画面ポーリング / 受け口の自前ポーリング）が
//   同じバッチを同時に回収して費用を二重計上しないよう、処理前に台帳行を SUBMITTED → COLLECTING へ
//   アトミックに掴む（UPDATE ... RETURNING）。掴めなかった行は他の経路が処理中なので触らない＝空振り。
//   COLLECTING 中は completedAt を「掴んだ時刻」として使う（完了時に本来の完了時刻で上書きされる）。
//   プロセス落ち等で掴んだまま放置された行は、次回の回収開始時に SUBMITTED へ戻して拾い直す。
const COLLECT_CLAIM_STALE_MS = 10 * 60 * 1000;
// T-189 修正: 投入の排他。台帳行を「Anthropic に投入する前」に RESERVED で先に確保する。
//   以前は batches.create 成功後に台帳へ INSERT していたため、同じ求職者に対する2つの投入経路
//   （「今すぐ探す」自身の投入と受け口キック）が同時に走ると、双方の未回収判定が「台帳に無い」を
//   見て素通りし、同一15ファイルが 0.355 秒差で2バッチに投入された（2026-09-03 11:52・¥59の無駄）。
//   対象確定と RESERVED の INSERT を1トランザクション＋advisory lock で直列化すれば、
//   後発の投入は「未回収の台帳行に載っている」＝対象0件で終わる（構造的な排他）。
const SUBMIT_LOCK_KEY = "recommend-analyze-submit";
// 未回収（＝そのファイルを再投入してはいけない）とみなす台帳ステータス。
const IN_FLIGHT_LEDGER_STATUSES = ["RESERVED", "SUBMITTED", "COLLECTING"];
// 予約したまま放置された行（投入直前にプロセスが落ちた等）を FAILED に落として再投入可能にする猶予。
const RESERVED_STALE_MS = 10 * 60 * 1000;
// RESERVED 行の batchId（Anthropic の batch id が決まるのは投入後なので、それまでの placeholder）。
const RESERVED_BATCH_PLACEHOLDER = "reserved";
// T-189 Phase3-2a: 評価回収時に PDF を先行生成する1回あたりの上限（env RECOMMEND_PDF_MAX_PER_RUN・既定100）
const DEFAULT_PDF_MAX_PER_RUN = 100;
function pdfMaxPerRun(): number {
  const n = Number.parseInt(process.env.RECOMMEND_PDF_MAX_PER_RUN ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PDF_MAX_PER_RUN;
}

// 費用試算用の概算値（dry_run 表示のみに使用。課金には一切影響しない）。
const EST_TOKENS_PER_CHAR = 0.92;
const EST_FIXED_TOKENS = 21308;
const EST_CONTEXT_TOKENS = 4424;
const EST_OUTPUT_TOKENS_PER_FILE = 1000;
const PRICE_INPUT_PER_MTOK = 5; // Opus 4.6
const PRICE_OUTPUT_PER_MTOK = 25;
const BATCH_DISCOUNT = 0.5;

export type AnalyzeSubmitResult = {
  mode: "EXECUTE" | "DRY-RUN";
  targetFiles: number;
  eligibleFiles: number;
  inFlightFiles: number;
  maxFiles: number;
  candidates: number;
  requests: number;
  requestPlan: { candidateId: string; files: number; range: string }[];
  estimate: {
    estInputTokens: number;
    estOutputTokens: number;
    estCostUsd: number;
    estCostJpy: number;
  };
  batchId?: string | null;
  /** 台帳保存に失敗（＝回収不能）。route 側で 500 にする。 */
  ledgerSaveFailed?: boolean;
};

type PlannedRequest = {
  customId: string;
  candidateId: string;
  fileIds: string[];
  totalFiles: number;
  start: number;
  end: number;
};

type SubmissionPlan = {
  capped: { id: string; candidateId: string; fileName: string; extractedText: string | null }[];
  eligibleCount: number;
  inFlightCount: number;
  planned: PlannedRequest[];
  candidateCount: number;
};

/**
 * 投入対象の確定（DB読みのみ・副作用なし）。
 * 実投入時は advisory lock を取ったトランザクション内で呼び、直後に RESERVED を INSERT する。
 */
async function planSubmission(
  db: Prisma.TransactionClient,
  args: { candidateId?: string; maxFiles: number },
): Promise<SubmissionPlan> {
  const { candidateId, maxFiles } = args;

  // 1. 対象ファイルの抽出（CA画面の対象条件 + 自動引き当て限定の3条件）。
  const candidates = await db.candidateFile.findMany({
    where: {
      category: "BOOKMARK",
      origin: "auto",
      approvalStatus: "PENDING",
      aiAnalyzedAt: null,
      extractedText: { not: null },
      archivedAt: null,
      ...(candidateId ? { candidateId } : {}),
    },
    select: { id: true, candidateId: true, fileName: true, extractedText: true },
    orderBy: { createdAt: "asc" },
  });

  // 2. 未回収のファイルを除外（二重投入防止）。
  //    FAILED / EXPIRED の行は除外しない＝対象ファイルが自動的に再投入対象へ戻る。
  //    T-189 修正: 回収中（COLLECTING）と投入予約中（RESERVED）も「未回収」なので除外対象に含める。
  //    RESERVED を含めるのが二重投入の本命の防波堤（投入前に予約済み＝後発は対象0件になる）。
  const inFlight = await db.recommendAnalyzeBatch.findMany({
    where: { status: { in: IN_FLIGHT_LEDGER_STATUSES } },
    select: { fileIds: true },
  });
  const inFlightIds = new Set<string>();
  for (const row of inFlight) {
    if (Array.isArray(row.fileIds)) {
      for (const id of row.fileIds) if (typeof id === "string") inFlightIds.add(id);
    }
  }
  const eligible = candidates.filter((f) => !inFlightIds.has(f.id));

  // 3. 上限適用 → 求職者ごとにグルーピング → 5件ずつのリクエストに分割。
  const capped = eligible.slice(0, maxFiles);
  const byCandidate = new Map<string, typeof capped>();
  for (const f of capped) {
    const arr = byCandidate.get(f.candidateId) ?? [];
    arr.push(f);
    byCandidate.set(f.candidateId, arr);
  }

  const planned: PlannedRequest[] = [];
  for (const [cid, files] of byCandidate) {
    for (let start = 0; start < files.length; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE, files.length);
      planned.push({
        customId: randomUUID(),
        candidateId: cid,
        fileIds: files.slice(start, end).map((f) => f.id),
        totalFiles: files.length,
        start,
        end,
      });
    }
  }

  return {
    capped,
    eligibleCount: eligible.length,
    inFlightCount: inFlightIds.size,
    planned,
    candidateCount: byCandidate.size,
  };
}

/**
 * 未評価の自動引き当てブックマークを Message Batches API へ投入する。
 * `candidateId` を渡すとその求職者の分だけを対象にする（画面の「今すぐ探す」用）。
 *
 * T-189 修正: 実投入時の順序を「対象確定 → 台帳に RESERVED を INSERT → Anthropic へ投入 →
 *   同じ行を SUBMITTED + batchId に確定」に変えた。対象確定と予約は advisory lock 付きの
 *   1トランザクションなので、同時に走った別経路の submit は「未回収の台帳行に載っている」を
 *   見て対象0件で終わる（＝同一ファイルが2バッチに入らない）。
 */
export async function runAnalyzeSubmit(opts: {
  willExecute: boolean;
  maxFiles?: number;
  candidateId?: string;
}): Promise<AnalyzeSubmitResult> {
  const { willExecute, candidateId } = opts;
  const envMax = Number(process.env.RECOMMEND_ANALYZE_MAX_FILES);
  const maxFiles =
    opts.maxFiles ?? (Number.isInteger(envMax) && envMax > 0 ? envMax : DEFAULT_MAX_FILES);

  // dry_run は照会のみ（ロックも予約もしない）。実投入は対象確定と予約を1トランザクションで直列化する。
  const plan = willExecute
    ? await prisma.$transaction(
        async (tx) => {
          // 同時に走る他の submit（定時cron / 受け口キック / 保険経路）と直列化する。
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SUBMIT_LOCK_KEY})::bigint)`;

          // 予約したまま放置された行を FAILED に落とす（投入直前にプロセスが落ちた場合の復旧）。
          const stale = await tx.recommendAnalyzeBatch.updateMany({
            where: {
              status: "RESERVED",
              submittedAt: { lt: new Date(Date.now() - RESERVED_STALE_MS) },
            },
            data: { status: "FAILED", completedAt: new Date() },
          });
          if (stale.count > 0) {
            console.warn(
              `[recommend/analyze-submit] 放置された RESERVED を ${stale.count}行 FAILED にした（再投入対象へ戻す）`,
            );
          }

          const p = await planSubmission(tx, { candidateId, maxFiles });
          if (p.planned.length > 0) {
            await tx.recommendAnalyzeBatch.createMany({
              data: p.planned.map((r) => ({
                id: r.customId,
                batchId: RESERVED_BATCH_PLACEHOLDER,
                candidateId: r.candidateId,
                fileIds: r.fileIds,
                status: "RESERVED",
              })),
            });
          }
          return p;
        },
        { timeout: 30_000, maxWait: 30_000 },
      )
    : await planSubmission(prisma, { candidateId, maxFiles });

  const { capped, planned } = plan;

  // 4. 費用試算（dry_run 表示のみに使用。課金には一切影響しない）。
  const jobChars = capped.reduce(
    (sum, f) => sum + Math.min((f.extractedText ?? "").length, 3000),
    0,
  );
  const estInputTokens = Math.round(
    planned.length * (EST_FIXED_TOKENS + EST_CONTEXT_TOKENS + 500) + jobChars * EST_TOKENS_PER_CHAR,
  );
  const estOutputTokens = capped.length * EST_OUTPUT_TOKENS_PER_FILE;
  const estCostUsd =
    ((estInputTokens * PRICE_INPUT_PER_MTOK + estOutputTokens * PRICE_OUTPUT_PER_MTOK) /
      1_000_000) *
    BATCH_DISCOUNT;

  const summary: AnalyzeSubmitResult = {
    mode: willExecute ? "EXECUTE" : "DRY-RUN",
    targetFiles: capped.length,
    eligibleFiles: plan.eligibleCount,
    inFlightFiles: plan.inFlightCount,
    maxFiles,
    candidates: plan.candidateCount,
    requests: planned.length,
    requestPlan: planned.map((r) => ({
      candidateId: r.candidateId,
      files: r.fileIds.length,
      range: `${r.start + 1}-${r.end}/${r.totalFiles}`,
    })),
    estimate: {
      estInputTokens,
      estOutputTokens,
      estCostUsd: Math.round(estCostUsd * 10000) / 10000,
      estCostJpy: Math.round(estCostUsd * 150),
    },
  };

  if (!willExecute) return summary;
  if (planned.length === 0) return { ...summary, batchId: null };

  const reservedIds = planned.map((r) => r.customId);
  /** 予約を解除して対象ファイルを再投入対象へ戻す（投入に至らなかった場合）。 */
  const releaseReservation = async () => {
    try {
      await prisma.recommendAnalyzeBatch.updateMany({
        where: { id: { in: reservedIds }, status: "RESERVED" },
        data: { status: "FAILED", completedAt: new Date() },
      });
    } catch (e) {
      // 落とせなくても RESERVED_STALE_MS 後に次回の submit が FAILED にする。
      console.error("[recommend/analyze-submit] 予約解除に失敗（10分後に自動で解除される）:", e);
    }
  };

  // 5. 実投入: 候補者contextを1回ずつ組み立て、全リクエストを1つの Message Batch にまとめる。
  let batch: { id: string };
  try {
    const fixedSystem = buildAnalyzeFixedSystem();
    const fileById = new Map(capped.map((f) => [f.id, f]));
    const contextByCandidate = new Map<string, string>();
    const requests = [];
    for (const r of planned) {
      let context = contextByCandidate.get(r.candidateId);
      if (context === undefined) {
        context = await buildAnalyzeCandidateContext(r.candidateId);
        contextByCandidate.set(r.candidateId, context);
      }
      const batchFiles = r.fileIds.map((id) => fileById.get(id)!);
      const jobsSection = buildAnalyzeJobsSection(batchFiles, r.start);
      const systemBlocks = buildAnalyzeBatchSystemBlocks({
        fixedSystem,
        candidateContext: context,
        // 総合まとめは自動経路では生成しない（常に非最終バッチの指示文）。
        batchInstruction: buildBatchInstruction({
          totalFiles: r.totalFiles,
          start: r.start,
          end: r.end,
          isLastBatch: false,
        }),
      });
      requests.push({
        custom_id: r.customId,
        params: {
          model: CLAUDE_MODEL_ANALYSIS,
          max_tokens: 16000,
          temperature: 0.7,
          system: systemBlocks,
          messages: [
            {
              role: "user" as const,
              content: `## 検討中の求人票（${r.start + 1}〜${r.end}件目 / 全${r.totalFiles}件）\n${jobsSection}\n\n上記の求人について分析してください。`,
            },
          ],
        },
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    batch = await anthropic.messages.batches.create({ requests: requests as any });
  } catch (e) {
    // 投入に至らなかった（context 組み立て失敗 / Anthropic エラー）。予約を解除して呼び出し元に返す。
    await releaseReservation();
    throw e;
  }

  // 6. 予約行を SUBMITTED + 実 batchId に確定する。ここが失敗すると回収不能になるため、
  //    失敗時は batchId をログに残す（Anthropic Console から手動回収可能）。
  try {
    const confirmed = await prisma.recommendAnalyzeBatch.updateMany({
      where: { id: { in: reservedIds }, status: "RESERVED" },
      data: { batchId: batch.id, status: "SUBMITTED" },
    });
    if (confirmed.count !== reservedIds.length) {
      console.error(
        `[recommend/analyze-submit] 予約行の確定件数が不一致（batchId=${batch.id} 予約=${reservedIds.length} 確定=${confirmed.count}）`,
      );
    }
  } catch (dbErr) {
    console.error(
      `[recommend/analyze-submit] 台帳の確定に失敗（batchId=${batch.id}）。回収不能のため要調査:`,
      dbErr,
    );
    return { ...summary, batchId: batch.id, ledgerSaveFailed: true };
  }

  console.log(
    `[recommend/analyze-submit] submitted batch=${batch.id} requests=${planned.length} files=${capped.length}${candidateId ? ` candidate=${candidateId}` : ""}`,
  );
  return { ...summary, batchId: batch.id };
}

export type AnalyzeCollectResult = {
  mode: "EXECUTE" | "DRY-RUN";
  pendingRows: number;
  batches: { batchId: string; processingStatus: string; rows: number }[];
  completedRows: number;
  failedRows: number;
  expiredRows: number;
  savedFiles: number;
  skippedFiles: number;
  autoRejectedD: number;
  // T-189 Phase3-2a: 評価回収後の PDF 先行生成（PENDING・D以外・driveFileId 無し）
  pdfTargets: number; // 生成対象として拾った件数（上限適用前）
  pdfGenerated: number;
  pdfFailed: number;
  pdfFailures: { fileId: string; error: string }[]; // 行ごとの失敗（driveFileId は null のままなので次回 collect で再試行）
};

/**
 * T-189 Phase3-2a: AI評価が付いた承認待ち（PENDING）の自動配信行のうち D 以外の PDF を先に作る。
 * 承認前にCAが承認ページで求人票を開けるようにするため（D は analyze-collect で自動却下されるので作らない）。
 *   対象: autoSourcedAt 非null・PENDING・archivedAt null・driveFileId null・externalJobRef あり・
 *         aiMatchRating 非null かつ "D" 以外（未評価の行は評価が付いてから）
 *   上限: RECOMMEND_PDF_MAX_PER_RUN（既定100）／1回。1件ずつ・失敗隔離。
 *   失敗した行は driveFileId が null のままなので次回の collect で自動的に再試行される。
 * 過去に評価済みで PDF が無い PENDING 行（この変更より前の引き当て分）も同じ条件で拾う。
 */
export async function generatePendingAutoPdfs(opts: { candidateId?: string }): Promise<{
  pdfTargets: number;
  pdfGenerated: number;
  pdfFailed: number;
  pdfFailures: { fileId: string; error: string }[];
}> {
  const targets = await prisma.candidateFile.findMany({
    where: {
      autoSourcedAt: { not: null },
      approvalStatus: "PENDING",
      archivedAt: null,
      driveFileId: null,
      externalJobRef: { not: null },
      aiMatchRating: { not: null, notIn: ["D"] },
      ...(opts.candidateId ? { candidateId: opts.candidateId } : {}),
    },
    select: { ...AUTO_FILE_PDF_SELECT, aiMatchRating: true },
    orderBy: [{ aiAnalyzedAt: "desc" }, { autoSourcedAt: "desc" }],
  });
  const cap = pdfMaxPerRun();
  const slice = targets.slice(0, cap);
  let pdfGenerated = 0;
  const pdfFailures: { fileId: string; error: string }[] = [];
  for (const f of slice) {
    const r = await generatePdfForAutoFile(f);
    if (r.ok) pdfGenerated++;
    else pdfFailures.push({ fileId: f.id, error: r.error ?? "unknown" });
  }
  if (targets.length > 0) {
    console.log(
      `[recommend/analyze-collect] pdf pre-generate targets=${targets.length} cap=${cap} generated=${pdfGenerated} failed=${pdfFailures.length}` +
        (opts.candidateId ? ` candidate=${opts.candidateId}` : ""),
    );
  }
  return { pdfTargets: targets.length, pdfGenerated, pdfFailed: pdfFailures.length, pdfFailures };
}

/**
 * T-189 修正: 回収対象の台帳行を SUBMITTED → COLLECTING でアトミックに掴む。
 * 掴めた行の id だけを返す（＝この呼び出しが責任を持って処理する行）。
 * 1行ずつの条件付き UPDATE なので、同時に走る別の回収は同じ行を掴めない（片方が空振りする）。
 */
async function claimRowsForCollect(ids: string[]): Promise<string[]> {
  const claimed: string[] = [];
  for (const id of ids) {
    const r = await prisma.recommendAnalyzeBatch.updateMany({
      where: { id, status: "SUBMITTED" },
      data: { status: "COLLECTING", completedAt: new Date() },
    });
    if (r.count === 1) claimed.push(id);
  }
  return claimed;
}

/** 掴んだまま処理し切れなかった行を SUBMITTED に戻す（次回の回収で拾い直す）。 */
async function releaseClaims(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.recommendAnalyzeBatch.updateMany({
    where: { id: { in: ids }, status: "COLLECTING" },
    data: { status: "SUBMITTED", completedAt: null },
  });
}

/**
 * 投入済みバッチの結果を回収して3軸を保存する。
 * `candidateId` を渡すとその求職者の台帳行だけを回収対象にする（他の行は次回の cron が拾う）。
 */
export async function runAnalyzeCollect(opts: {
  willExecute: boolean;
  candidateId?: string;
}): Promise<AnalyzeCollectResult> {
  const { willExecute, candidateId } = opts;

  // 掴んだまま放置された行（回収中にプロセスが落ちた等）を SUBMITTED に戻す。
  // これを先にやることで、以降の findMany が取りこぼさない。
  if (willExecute) {
    const stale = await prisma.recommendAnalyzeBatch.updateMany({
      where: {
        status: "COLLECTING",
        OR: [
          { completedAt: { lt: new Date(Date.now() - COLLECT_CLAIM_STALE_MS) } },
          { completedAt: null },
        ],
        ...(candidateId ? { candidateId } : {}),
      },
      data: { status: "SUBMITTED", completedAt: null },
    });
    if (stale.count > 0) {
      console.warn(`[recommend/analyze-collect] 放置された COLLECTING を ${stale.count}行 SUBMITTED に戻した`);
    }
  }

  const rows = await prisma.recommendAnalyzeBatch.findMany({
    where: { status: "SUBMITTED", ...(candidateId ? { candidateId } : {}) },
    select: { id: true, batchId: true, candidateId: true, fileIds: true, submittedAt: true },
  });
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const batchIds = [...new Set(rows.map((r) => r.batchId))];

  let completedRows = 0;
  let failedRows = 0;
  let expiredRows = 0;
  let savedFiles = 0;
  let skippedFiles = 0; // fail-closed（3点セット不揃い）で保存しなかったファイル
  let autoRejectedD = 0; // T-189 Phase3-1: 評価 D で自動却下した自動配信行
  const batchStatuses: { batchId: string; processingStatus: string; rows: number }[] = [];

  for (const batchId of batchIds) {
    const batchRows = rows.filter((r) => r.batchId === batchId);
    let processingStatus = "unknown";
    try {
      const mb = await anthropic.messages.batches.retrieve(batchId);
      processingStatus = mb.processing_status;
    } catch (e) {
      console.error(`[recommend/analyze-collect] retrieve failed batch=${batchId}:`, e);
      batchStatuses.push({ batchId, processingStatus: "retrieve-error", rows: batchRows.length });
      continue;
    }
    batchStatuses.push({ batchId, processingStatus, rows: batchRows.length });

    if (processingStatus !== "ended") {
      // 24h を超えて未完了なら期限切れ扱い（対象ファイルは次回 submit で再投入対象に戻る）。
      const oldest = Math.min(...batchRows.map((r) => r.submittedAt.getTime()));
      if (willExecute && Date.now() - oldest > BATCH_TIMEOUT_MS) {
        // candidateId 指定時も、期限切れにするのは対象の行だけ（他求職者の行は触らない）。
        await prisma.recommendAnalyzeBatch.updateMany({
          where: { id: { in: batchRows.map((r) => r.id) }, status: "SUBMITTED" },
          data: { status: "EXPIRED", completedAt: new Date() },
        });
        expiredRows += batchRows.length;
        console.warn(
          `[recommend/analyze-collect] batch=${batchId} 24h超過のため EXPIRED (${batchRows.length}行)`,
        );
      }
      continue;
    }

    if (!willExecute) continue; // DRY-RUN は照会のみ

    // T-189 修正: 排他。このバッチの台帳行のうち、まだ誰も掴んでいない行だけを掴む。
    // 定時 cron と自前ポーリングが同時に走っても、掴めなかった側はここで空振りして次へ進む。
    const claimedIds = await claimRowsForCollect(batchRows.map((r) => r.id));
    if (claimedIds.length === 0) {
      console.log(`[recommend/analyze-collect] batch=${batchId} 他経路が回収中のためスキップ`);
      continue;
    }
    const claimed = new Set(claimedIds);

    try {
      for await (const result of await anthropic.messages.batches.results(batchId)) {
        const row = rowById.get(result.custom_id);
        // 対象外（＝他求職者の行 / 別バッチ / 他経路が掴んだ行）は触らない。次回の cron が拾う。
        if (!row || row.batchId !== batchId || !claimed.has(row.id)) continue;
        const fileIds = Array.isArray(row.fileIds)
          ? row.fileIds.filter((v): v is string => typeof v === "string")
          : [];

        if (result.result.type === "succeeded") {
          const message = result.result.message;
          const analysisText = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
          const batchFiles = await prisma.candidateFile.findMany({
            where: { id: { in: fileIds } },
            select: { id: true, fileName: true },
          });
          // CA画面経路と同一の解析・fail-closed 保存（3点セット揃いのみ更新）。
          const { ratingsAndComments, skippedFileIds } = await applyAnalysisResults({
            analysisText,
            batchFiles,
            candidateId: row.candidateId,
            dryRun: false,
          });
          savedFiles += batchFiles.length - skippedFileIds.length;
          skippedFiles += skippedFileIds.length;

          // T-189 Phase3-1: 評価 D の自動配信行は承認待ちに並べず、その場で自動却下する。
          const savedDIds = [...ratingsAndComments]
            .filter(([id, v]) => v.rating === "D" && !skippedFileIds.includes(id))
            .map(([id]) => id);
          if (savedDIds.length > 0) {
            autoRejectedD += await rejectAutoFiles({
              fileIds: savedDIds,
              rejectedReason: AUTO_REJECT_REASON_D,
            });
          }

          await recordAdvisorUsage({
            endpoint: "recommend-analyze",
            model: message.model,
            usage: message.usage as AnthropicUsage,
            candidateId: row.candidateId,
            fileCount: fileIds.length,
            batchApi: true, // バッチ割引（全トークン種別 ×0.5）を費用計上に反映
            note: `batch=${batchId}`,
          });

          await prisma.recommendAnalyzeBatch.update({
            where: { id: row.id },
            data: { status: "COMPLETED", completedAt: new Date() },
          });
          claimed.delete(row.id); // 処理済み。以降 finally での差し戻し対象から外す
          completedRows++;
        } else {
          const status = result.result.type === "expired" ? "EXPIRED" : "FAILED";
          console.warn(
            `[recommend/analyze-collect] batch=${batchId} custom_id=${row.id} result=${result.result.type} → ${status} (files=${fileIds.length})`,
          );
          await prisma.recommendAnalyzeBatch.update({
            where: { id: row.id },
            data: { status, completedAt: new Date() },
          });
          claimed.delete(row.id);
          if (status === "EXPIRED") expiredRows++;
          else failedRows++;
        }
      }
    } finally {
      // 結果ストリームに現れなかった行・途中で例外になった行は掴んだままにしない。
      await releaseClaims([...claimed]);
    }
  }

  // T-189 Phase3-2a: 評価を保存した直後に、承認待ち（D以外）の PDF を先に作っておく。
  // 今回のバッチで評価が付いた行だけでなく、以前の失敗分・未生成分も同じ条件で拾う（＝再試行）。
  const pdf = willExecute
    ? await generatePendingAutoPdfs({ candidateId })
    : { pdfTargets: 0, pdfGenerated: 0, pdfFailed: 0, pdfFailures: [] };

  return {
    mode: willExecute ? "EXECUTE" : "DRY-RUN",
    pendingRows: rows.length,
    batches: batchStatuses,
    completedRows,
    failedRows,
    expiredRows,
    savedFiles,
    skippedFiles,
    autoRejectedD,
    ...pdf,
  };
}
