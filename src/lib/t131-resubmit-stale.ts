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
import { prisma } from "@/lib/prisma";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { submitPdfToJobPlatform } from "@/lib/job-platform-ingest";

export const RESUBMIT_STALE_MS = 30 * 60 * 1000; // 30分（T-133 FU-9で2時間から短縮）
export const RESUBMIT_BATCH_CAP = 50; // 1回の実行上限（手動スクリプト既定）
// 遡及（本機能ローンチ前の4,204件）を対象外にする作成日時の下限。env で上書き可。
export const RESUBMIT_CUTOFF_DEFAULT = "2026-07-04T00:00:00+09:00";

export type ResubmitStaleSummary = {
  mode: "EXECUTE" | "DRY-RUN";
  cutoff: string;
  candidates: number; // 未紐付け・抽出済の総数
  stale: number; // うち滞留（STALE_MS 超）
  batchCap: number;
  processed: number; // 実処理した数（再クレーム成功件）
  ok: number; // 投入成功→紐付け
  ng: number; // 送信/取得失敗
  skipped: number; // 再クレーム敗退（他プロセスが処理中 or 紐付け済み）
  errors: { fileId: string; error: string }[];
  durationMs: number;
};

/**
 * 滞留した未投入ブックマークを再投入する。既定は DRY-RUN（DB/HTTPとも触らない）。
 * execute=true で再クレーム→ダウンロード→送信→externalJobRef 書き戻し。対象0件時は何もしない。
 */
export async function runResubmitStale(opts?: {
  execute?: boolean;
  batchCap?: number;
  staleMs?: number;
  cutoff?: Date;
  log?: (msg: string) => void;
}): Promise<ResubmitStaleSummary> {
  const execute = opts?.execute ?? false;
  const batchCap = opts?.batchCap ?? RESUBMIT_BATCH_CAP;
  const staleMs = opts?.staleMs ?? RESUBMIT_STALE_MS;
  const cutoff =
    opts?.cutoff ?? new Date(process.env.T131_STALE_CUTOFF ?? RESUBMIT_CUTOFF_DEFAULT);
  const log = opts?.log ?? (() => {});
  const startedAt = Date.now();
  const staleBefore = new Date(startedAt - staleMs);

  const rows = await prisma.candidateFile.findMany({
    where: {
      sourceType: null,
      externalJobRef: null,
      category: "BOOKMARK",
      archivedAt: null,
      extractedText: { not: null },
      driveFileId: { not: null },
      createdAt: { gte: cutoff },
    },
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

  const summary: ResubmitStaleSummary = {
    mode: execute ? "EXECUTE" : "DRY-RUN",
    cutoff: cutoff.toISOString(),
    candidates: rows.length,
    stale: stale.length,
    batchCap,
    processed: 0,
    ok: 0,
    ng: 0,
    skipped: 0,
    errors: [],
    durationMs: 0,
  };

  log(
    `[t131-resubmit] CUTOFF=${summary.cutoff} / 候補(未紐付け・抽出済) ${rows.length}件 / 滞留(${staleMs / 60000}分超) ${stale.length}件 / mode=${summary.mode}`,
  );
  if (stale.length > batchCap) {
    log(`[t131-resubmit] 上限 ${batchCap} 件のため今回 ${target.length}件（残 ${stale.length - batchCap}件は次回）`);
  }

  for (const r of target) {
    const tag = `fileId=${r.id} cand=${r.candidateId} file=${r.fileName}`;
    if (!execute) {
      log(`  [DRY] ${tag} created=${r.createdAt.toISOString()} lastSubmit=${r.platformSubmittedAt?.toISOString() ?? "-"}`);
      continue;
    }

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
      continue;
    }
    if (claimCount === 0) {
      summary.skipped++;
      log(`  [SKIP] ${tag}（他プロセスがクレーム済み or 紐付け済み）`);
      continue;
    }

    summary.processed++;
    try {
      const { base64 } = await downloadFileFromDrive(r.driveFileId!);
      const pdfBuffer = Buffer.from(base64, "base64");
      const res = await submitPdfToJobPlatform({ fileId: r.id, fileName: r.fileName, pdfBuffer });
      if (res.ok) {
        await prisma.candidateFile.update({
          where: { id: r.id },
          data: { externalJobRef: res.sourceJobId, platformSubmittedAt: new Date() },
        });
        summary.ok++;
        log(`  [OK] ${tag} → ${res.sourceJobId} (status=${res.status} deduped=${res.deduped})`);
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
  }

  summary.durationMs = Date.now() - startedAt;
  log(
    `[t131-resubmit] 完了 mode=${summary.mode} processed=${summary.processed} ok=${summary.ok} ng=${summary.ng} skipped=${summary.skipped} (${summary.durationMs}ms)`,
  );
  return summary;
}
