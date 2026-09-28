// T-131 step2: 手動アップPDFの job-platform 投入「滞留」拾い直しの共有ロジック。
//
// アップ時の自動投入（extract-text の fire-and-forget → ingestAndLink）が失敗・取りこぼした行を、
// 後追いで再投入して無言消失を防ぐ。scripts/t131-resubmit-stale.ts（手動）と
// /api/internal/bookmarks/resubmit-stale（定期自動・GitHub Actions cron）の両方から呼ぶ。
//
// FU-8恒久修正（投入前クレーム方式に整合）:
//   - 対象滞留 = externalJobRef が null かつ（platformSubmittedAt が null または STALE_MS 以上前）。
//     ingestAndLink がクレーム時に platformSubmittedAt=now を打つため、変換中の作りたては拾わない。
//   - 拾う際に **再クレーム**（同条件の updateMany で platformSubmittedAt=now を打つ）してから再送信する。
//     更新0件 = 他プロセス（別の cron 実行・手動実行）が先にクレーム or 既に紐付いた → スキップ（二重送信の排他）。
//   - job-platform 側も内容ハッシュで二重登録を弾くため、万一の二重送信でも安全（多層防御）。
//
// T-XXX（2026-09-28）: 送り直し処理が 2026-08-25 以降ほぼ毎回失敗していた恒久修正。
//   - 原因: 1回10件を直列で回し（1件30〜40秒・失敗時は最長120秒）、Railway の HTTP プロキシ上限 300 秒を
//     超えて 502 upstream error になっていた（GitHub Actions 側は 5分00秒で失敗）。
//   - 対処: 並列度（既定3）と時間の上限（既定150秒＝新規着手の打ち切り。1件120秒タイムアウトでも 300 秒以内に
//     返る）を入れ、必ず時間内に終わる作りにした。
//   - 自動実行の対象は「作成から直近 N 日以内」（既定3日・env T131_RESUBMIT_WINDOW_DAYS）に限定する。
//     たまっている古い分（T-131 ローンチ前の遡及分や Gemini 生タブで永久失敗する行）を一斉に送って
//     AI 費用が出ないようにするため。古い分は件数だけ summary.outsideWindow に報告する。
//   - 投入成功時の書き戻しは ingestAndLink と同じ buildLinkData（媒体・エリア・職種も保存）。
import { prisma } from "@/lib/prisma";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { submitPdfToJobPlatform, buildLinkData } from "@/lib/job-platform-ingest";

export const RESUBMIT_STALE_MS = 30 * 60 * 1000; // 30分（T-133 FU-9で2時間から短縮）
export const RESUBMIT_BATCH_CAP = 50; // 1回の実行上限（手動スクリプト既定）
// 遡及（本機能ローンチ前の4,204件）を対象外にする作成日時の下限。env で上書き可。
export const RESUBMIT_CUTOFF_DEFAULT = "2026-07-04T00:00:00+09:00";
// T-XXX: 自動実行の対象期間（作成から N 日以内）。env T131_RESUBMIT_WINDOW_DAYS で上書き可。
export const RESUBMIT_WINDOW_DAYS_DEFAULT = 3;
// T-XXX: 並列度と時間の上限（新規着手を打ち切る経過時間）。
export const RESUBMIT_CONCURRENCY_DEFAULT = 3;
export const RESUBMIT_TIME_BUDGET_MS_DEFAULT = 150_000;

export type ResubmitStaleSummary = {
  mode: "EXECUTE" | "DRY-RUN";
  cutoff: string;
  /** T-XXX: 対象期間（日）。null は無制限（手動指定時のみ） */
  windowDays: number | null;
  /** T-XXX: 対象期間の下限（createdAt >= windowStart）。null は無制限 */
  windowStart: string | null;
  candidates: number; // 未紐付け・抽出済の総数（対象期間内）
  stale: number; // うち滞留（STALE_MS 超）
  /** T-XXX: 対象期間より古い滞留（cutoff 以前も含む全体）。自動では送らない＝報告のみ */
  outsideWindow: { files: number; candidates: number };
  batchCap: number;
  concurrency: number;
  timeBudgetMs: number;
  processed: number; // 実処理した数（再クレーム成功件）
  ok: number; // 投入成功→紐付け
  ng: number; // 送信/取得失敗
  skipped: number; // 再クレーム敗退（他プロセスが処理中 or 紐付け済み）
  /** T-XXX: 時間の上限で着手しなかった数（次回に持ち越し） */
  deferred: number;
  errors: { fileId: string; error: string }[];
  durationMs: number;
};

function resolveWindowDays(v: number | null | undefined): number | null {
  if (v === null) return null;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  const env = Number(process.env.T131_RESUBMIT_WINDOW_DAYS);
  return Number.isFinite(env) && env > 0 ? env : RESUBMIT_WINDOW_DAYS_DEFAULT;
}

/**
 * 滞留した未投入ブックマークを再投入する。既定は DRY-RUN（DB/HTTPとも触らない）。
 * execute=true で再クレーム→ダウンロード→送信→externalJobRef 書き戻し。対象0件時は何もしない（正常終了）。
 */
export async function runResubmitStale(opts?: {
  execute?: boolean;
  batchCap?: number;
  staleMs?: number;
  cutoff?: Date;
  /** T-XXX: 作成から N 日以内だけを対象にする。null で無制限（手動のみ）。未指定は env → 既定3日 */
  windowDays?: number | null;
  concurrency?: number;
  timeBudgetMs?: number;
  /** T-XXX: 手動の絞り込み（特定の求職者・特定の行だけ送り直す） */
  candidateIds?: string[];
  fileIds?: string[];
  log?: (msg: string) => void;
}): Promise<ResubmitStaleSummary> {
  const execute = opts?.execute ?? false;
  const batchCap = opts?.batchCap ?? RESUBMIT_BATCH_CAP;
  const staleMs = opts?.staleMs ?? RESUBMIT_STALE_MS;
  const cutoff =
    opts?.cutoff ?? new Date(process.env.T131_STALE_CUTOFF ?? RESUBMIT_CUTOFF_DEFAULT);
  const windowDays = resolveWindowDays(opts?.windowDays);
  const concurrency = Math.max(1, Math.min(10, opts?.concurrency ?? RESUBMIT_CONCURRENCY_DEFAULT));
  const timeBudgetMs = opts?.timeBudgetMs ?? RESUBMIT_TIME_BUDGET_MS_DEFAULT;
  const log = opts?.log ?? (() => {});
  const startedAt = Date.now();
  const staleBefore = new Date(startedAt - staleMs);
  const windowStart = windowDays === null ? null : new Date(startedAt - windowDays * 24 * 60 * 60 * 1000);
  // 対象の下限 = max(cutoff, windowStart)
  const lowerBound =
    windowStart && windowStart.getTime() > cutoff.getTime() ? windowStart : cutoff;

  const baseWhere = {
    sourceType: null,
    externalJobRef: null,
    category: "BOOKMARK" as const,
    archivedAt: null,
    extractedText: { not: null },
    driveFileId: { not: null },
    ...(opts?.candidateIds?.length ? { candidateId: { in: opts.candidateIds } } : {}),
    ...(opts?.fileIds?.length ? { id: { in: opts.fileIds } } : {}),
  };

  const rows = await prisma.candidateFile.findMany({
    where: { ...baseWhere, createdAt: { gte: lowerBound } },
    select: {
      id: true,
      candidateId: true,
      fileName: true,
      driveFileId: true,
      createdAt: true,
      platformSubmittedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // 「作成 または 直近クレームから STALE_MS 以上経過」= max(createdAt, platformSubmittedAt) が staleBefore 以前。
  const stale = rows.filter((r) => (r.platformSubmittedAt ?? r.createdAt) <= staleBefore);
  const target = stale.slice(0, batchCap);

  // 対象期間より古い滞留（cutoff 以前の遡及分も含めた全体）。自動では送らず件数だけ報告する。
  const outside = await prisma.candidateFile.groupBy({
    by: ["candidateId"],
    where: { ...baseWhere, createdAt: { lt: lowerBound } },
    _count: { _all: true },
  });
  const outsideWindow = {
    files: outside.reduce((a, g) => a + g._count._all, 0),
    candidates: outside.length,
  };

  const summary: ResubmitStaleSummary = {
    mode: execute ? "EXECUTE" : "DRY-RUN",
    cutoff: cutoff.toISOString(),
    windowDays,
    windowStart: windowStart ? windowStart.toISOString() : null,
    candidates: rows.length,
    stale: stale.length,
    outsideWindow,
    batchCap,
    concurrency,
    timeBudgetMs,
    processed: 0,
    ok: 0,
    ng: 0,
    skipped: 0,
    deferred: 0,
    errors: [],
    durationMs: 0,
  };

  log(
    `[t131-resubmit] CUTOFF=${summary.cutoff} WINDOW=${windowDays === null ? "無制限" : `${windowDays}日`}（下限 ${lowerBound.toISOString()}） / 候補(未紐付け・抽出済) ${rows.length}件 / 滞留(${staleMs / 60000}分超) ${stale.length}件 / 期間外の滞留 ${outsideWindow.files}件(${outsideWindow.candidates}名・送らない) / mode=${summary.mode} 並列=${concurrency} 時間上限=${timeBudgetMs / 1000}秒`,
  );
  if (stale.length > batchCap) {
    log(`[t131-resubmit] 上限 ${batchCap} 件のため今回 ${target.length}件（残 ${stale.length - batchCap}件は次回）`);
  }

  if (!execute) {
    for (const r of target) {
      log(
        `  [DRY] fileId=${r.id} cand=${r.candidateId} file=${r.fileName} created=${r.createdAt.toISOString()} lastSubmit=${r.platformSubmittedAt?.toISOString() ?? "-"}`,
      );
    }
    summary.durationMs = Date.now() - startedAt;
    log(`[t131-resubmit] 完了 mode=DRY-RUN 対象 ${target.length}件 (${summary.durationMs}ms)`);
    return summary;
  }

  const processOne = async (r: (typeof target)[number]) => {
    const tag = `fileId=${r.id} cand=${r.candidateId} file=${r.fileName}`;

    // 再クレーム（送信前に platformSubmittedAt=now を打つ）。更新0件なら他プロセスが先着 → スキップ。
    let claimCount: number;
    try {
      const claim = await prisma.candidateFile.updateMany({
        where: {
          id: r.id,
          externalJobRef: null,
          OR: [{ platformSubmittedAt: null }, { platformSubmittedAt: { lt: staleBefore } }],
        },
        data: { platformSubmittedAt: new Date() },
      });
      claimCount = claim.count;
    } catch (e) {
      summary.processed++;
      summary.ng++;
      const err = e instanceof Error ? e.message : String(e);
      summary.errors.push({ fileId: r.id, error: `claim: ${err}` });
      log(`  [ERR] ${tag}: 再クレーム失敗 ${err}`);
      return;
    }
    if (claimCount === 0) {
      summary.skipped++;
      log(`  [SKIP] ${tag}（他プロセスがクレーム済み or 紐付け済み）`);
      return;
    }

    summary.processed++;
    try {
      const { base64 } = await downloadFileFromDrive(r.driveFileId!);
      const pdfBuffer = Buffer.from(base64, "base64");
      const res = await submitPdfToJobPlatform({ fileId: r.id, fileName: r.fileName, pdfBuffer });
      if (res.ok) {
        // 予備の媒体判定用に本文だけ引く（一覧 select では重いので対象行のみ）。
        const textRow = await prisma.candidateFile.findUnique({
          where: { id: r.id },
          select: { extractedText: true },
        });
        const data = buildLinkData(res, { fileName: r.fileName, extractedText: textRow?.extractedText });
        await prisma.candidateFile.update({ where: { id: r.id }, data });
        summary.ok++;
        log(
          `  [OK] ${tag} → ${res.sourceJobId} (status=${res.status} deduped=${res.deduped} media=${data.sourceMedia}${data.jobArea ? ` area=${data.jobArea} category=${data.jobCategory}` : ""})`,
        );
      } else {
        // 失敗: platformSubmittedAt は再クレームで now 済み → 30分間は再試行しない。
        summary.ng++;
        summary.errors.push({ fileId: r.id, error: res.error });
        log(`  [NG] ${tag}: ${res.error}`);
      }
    } catch (e) {
      // Drive取得失敗等。platformSubmittedAt は再クレームで now 済み（1件の失敗で全体を止めない）。
      summary.ng++;
      const err = e instanceof Error ? e.message : String(e);
      summary.errors.push({ fileId: r.id, error: err });
      log(`  [ERR] ${tag}: ${err}`);
    }
  };

  // 並列ワーカー: 共有カーソルから順に取り出す。時間の上限を過ぎたら新規着手せず残りは deferred。
  let cursor = 0;
  const worker = async () => {
    while (cursor < target.length) {
      if (Date.now() - startedAt > timeBudgetMs) {
        summary.deferred += target.length - cursor;
        cursor = target.length;
        log(`[t131-resubmit] 時間の上限 ${timeBudgetMs / 1000}秒を超えたため残り ${summary.deferred}件は次回`);
        return;
      }
      const r = target[cursor++];
      await processOne(r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, target.length) }, () => worker()));

  summary.durationMs = Date.now() - startedAt;
  log(
    `[t131-resubmit] 完了 mode=${summary.mode} processed=${summary.processed} ok=${summary.ok} ng=${summary.ng} skipped=${summary.skipped} deferred=${summary.deferred} (${summary.durationMs}ms)`,
  );
  return summary;
}
