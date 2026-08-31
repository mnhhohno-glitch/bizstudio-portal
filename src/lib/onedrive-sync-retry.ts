/**
 * T-159 Phase 2-c: OneDrive コピーの夜間拾い直し。
 *
 * アップロード時の1回で終わらせず、`onedrive_sync_logs` に残った未達の行を毎晩もう一度試す。
 * 呼び出し口は POST /api/internal/onedrive-sync/retry（GitHub Actions cron / JST 02:00）。
 *
 * ★過去ファイルの一括コピーは対象外。本ファイルは `onedrive_sync_logs` に**行があるもの**しか触らない。
 *   行の有無が「同期対象として受け付けたか」の唯一の判定であり（enqueueOneDriveSync の契約）、
 *   candidate_files（10万行超）を起点にすると全走査になる。
 *
 * ★2種類の「拾い直し」を区別しているのがこのファイルの要点。
 *   (a) 失敗の再試行     … status=FAILED。attemptCount を数え、指数バックオフで待ち、5回で GIVEN_UP。
 *   (b) 状況待ちの再確認 … status=SKIPPED のうち「後から CA が直しうる」もの。
 *                          フォルダURLの登録・フォルダの作成・PDFの後付けは portal 側からは検知できないので、
 *                          毎晩ただ見に行く。これは失敗ではないので attemptCount を増やさない
 *                          （増やすと数日で GIVEN_UP に達し、CA が直した頃には二度と拾われない）。
 *                          代わりに lastAttemptedAt で24時間のクールダウンを掛けて往復を1日1回に抑える。
 */

import type { Prisma } from "@prisma/client";
import { OneDriveSyncSkipReason, OneDriveSyncStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ONEDRIVE_SUBFOLDER_BY_CATEGORY,
  ONEDRIVE_SYNC_MAX_ATTEMPTS,
  isOneDriveSyncEnabled,
  nextOneDriveRetryAt,
  runOneDriveSyncForFile,
} from "@/lib/onedrive-sync";

// ============================================================
// 実行制御の定数
// ============================================================

/** 1回の実行で処理する上限。超過分は翌日に回す（Graph への集中とリクエスト時間の両方を抑える）。 */
export const ONEDRIVE_RETRY_DEFAULT_LIMIT = 300;

/** 同時に走らせる件数。Graph の 429 を誘発しない範囲に留める。 */
export const ONEDRIVE_RETRY_CONCURRENCY = 3;

/**
 * SKIPPED からの状況待ち再確認のクールダウン（時間）。
 * 同じものを毎晩無限に試し続けないため、lastAttemptedAt からこれだけ空いているものだけを対象にする。
 */
export const ONEDRIVE_RETRY_SKIP_COOLDOWN_HOURS = 24;

/**
 * 1回の実行に使う実時間の上限（ミリ秒）。これを超えたら新しい件を取り出さずに打ち切る。
 * GitHub Actions の curl --max-time（600秒）より内側で必ず返せるようにするため。
 * 打ち切った分は次回の実行で拾われる（状態はすべて DB 側にあるので取りこぼさない）。
 */
export const ONEDRIVE_RETRY_DEFAULT_BUDGET_MS = 480_000;

/**
 * 状況待ちとして拾い直す skipReason。**ここに無い SKIPPED は二度と拾わない。**
 *
 *   NO_FOLDER_URL  … 後から CA が OneDrive フォルダURLを登録しうる
 *   BAD_FOLDER_URL … 後から CA が URL を貼り直しうる
 *   NO_SUBFOLDER   … 後から CA が 2.求人 / 3.BS作成書類 を作りうる（portal はフォルダを作らない）
 *   NO_FILE_BODY   … 後から PDF 実体が付きうる（サイト経由の求人など）
 *
 * 外してあるもの:
 *   NAME_ALREADY_EXISTS … 既に OneDrive にある。上書きしないのが仕様なので再試行に意味がない
 *   UNSUPPORTED_CATEGORY … カテゴリは変わらない
 *   GRAPH_ERROR（SKIPPED 側）… 壊れたファイル名・書き込み先ガード中止。入力が同じなら結果も同じ
 *   SYNC_DISABLED … Phase 2-b 以降は使わない値（停止中は PENDING 据え置き）
 */
export const ONEDRIVE_RETRYABLE_SKIP_REASONS: OneDriveSyncSkipReason[] = [
  OneDriveSyncSkipReason.NO_FOLDER_URL,
  OneDriveSyncSkipReason.BAD_FOLDER_URL,
  OneDriveSyncSkipReason.NO_SUBFOLDER,
  OneDriveSyncSkipReason.NO_FILE_BODY,
];

// ============================================================
// 拾い直し対象の抽出条件（純関数）
// ============================================================

/**
 * 夜間処理が拾う行の条件。
 *
 * ★`candidateFile.driveFileId` が null の行は**クエリの段階で外す**。
 *   実体が無いので何度試しても NO_FILE_BODY にしかならず、後段で弾く形にすると
 *   毎晩それらを取り出して Graph へ投げる前に捨てるだけの空回りになる。
 */
export function buildOneDriveRetryWhere(now: Date): Prisma.OneDriveSyncLogWhereInput {
  const cooldownCutoff = new Date(
    now.getTime() - ONEDRIVE_RETRY_SKIP_COOLDOWN_HOURS * 60 * 60 * 1000,
  );

  return {
    // ファイル本体を持つ行だけ（ここで絞らないと candidate_files 側の10万行を後段で捨てる形になる）
    candidateFile: { driveFileId: { not: null } },
    OR: [
      // (1) まだ試していない。キルスイッチ停止中に積まれた分もここに入る。
      { status: OneDriveSyncStatus.PENDING },
      // (2) 一時的な失敗。バックオフを過ぎ、上限未満のものだけ。
      {
        status: OneDriveSyncStatus.FAILED,
        attemptCount: { lt: ONEDRIVE_SYNC_MAX_ATTEMPTS },
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      },
      // (3) 状況待ち。24時間のクールダウンを置いて1日1回だけ見に行く。
      {
        status: OneDriveSyncStatus.SKIPPED,
        skipReason: { in: ONEDRIVE_RETRYABLE_SKIP_REASONS },
        OR: [{ lastAttemptedAt: null }, { lastAttemptedAt: { lte: cooldownCutoff } }],
      },
    ],
  };
}

// ============================================================
// 1件ぶんの後始末（純関数）
// ============================================================

export interface RetryBookkeepingInput {
  /** 拾った時点の status が SKIPPED だったか（＝状況待ちの再確認だったか）。 */
  fromSkipped: boolean;
  /** 拾った時点の attemptCount。 */
  previousAttemptCount: number;
  /** 試行の結果 status。 */
  outcomeStatus: OneDriveSyncStatus;
  /** Graph へ実際に1往復以上したか。 */
  graphAttempted: boolean;
  now: Date;
}

export interface RetryBookkeepingResult {
  attemptCount: number;
  nextRetryAt: Date | null;
  /** GIVEN_UP へ昇格させる場合のみ値が入る。null なら status は試行結果のまま。 */
  statusOverride: OneDriveSyncStatus | null;
}

/**
 * 拾い直し1件の後に、再試行制御の3列（attemptCount / nextRetryAt / status）をどう確定させるか。
 *
 * lastAttemptedAt は結果に関わらず必ず now に進める（呼び出し側の責務）。Graph に届かなかった回も
 * 「今夜は見に行った」の記録が要るため。ここを省くと NO_FOLDER_URL の行は lastAttemptedAt が
 * 永遠に null のままになり、24時間クールダウンが効かなくなる。
 */
export function decideRetryBookkeeping(input: RetryBookkeepingInput): RetryBookkeepingResult {
  // 状況待ちの再確認は失敗ではないので数えない。CA が直すまで何日でも待てるようにする。
  const attemptCount = input.fromSkipped
    ? input.previousAttemptCount
    : input.graphAttempted
      ? input.previousAttemptCount + 1
      : input.previousAttemptCount;

  if (input.outcomeStatus !== OneDriveSyncStatus.FAILED) {
    // SUCCESS / SKIPPED / PENDING（停止中）はバックオフを持たない。
    return { attemptCount, nextRetryAt: null, statusOverride: null };
  }

  const nextRetryAt = nextOneDriveRetryAt(attemptCount, input.now);
  return nextRetryAt === null
    ? { attemptCount, nextRetryAt: null, statusOverride: OneDriveSyncStatus.GIVEN_UP }
    : { attemptCount, nextRetryAt, statusOverride: null };
}

// ============================================================
// 実行
// ============================================================

/** CA に手を動かしてもらう必要がある理由。通知と画面の文言はこの粒度で出し分ける。 */
export const ONEDRIVE_CA_ACTION_REASONS: OneDriveSyncSkipReason[] = [
  OneDriveSyncSkipReason.NO_SUBFOLDER,
  OneDriveSyncSkipReason.NO_FOLDER_URL,
  OneDriveSyncSkipReason.BAD_FOLDER_URL,
];

export interface OneDriveRetryReasonBucket {
  reason: OneDriveSyncSkipReason;
  files: number;
  /** 重複を除いた求職者の人数（通知はこちらを「〜名」として出す）。 */
  candidates: number;
}

export interface OneDriveSyncRetrySummary {
  mode: "dry-run" | "execute";
  /** キルスイッチ。false のときは実行しても何も進まない（PENDING 据え置き）ので明示して返す。 */
  syncEnabled: boolean;
  /** 条件に合致した総数（limit 適用前）。 */
  eligible: number;
  /** 今回取り出した件数（limit 適用後）。 */
  picked: number;
  /** 実際に試行した件数。 */
  processed: number;
  /** limit または実時間上限で残した件数。 */
  deferred: number;
  success: number;
  givenUp: number;
  /** 試行結果の status 別内訳。 */
  byStatus: Record<string, number>;
  /** 試行結果の skipReason 別内訳（SUCCESS は "-"）。 */
  bySkipReason: Record<string, number>;
  /** CA の対応が必要なもの（理由別・今回の結果ぶん）。 */
  needsAttention: OneDriveRetryReasonBucket[];
  /** NO_SUBFOLDER で不足していたサブフォルダ名（通知文で「「2.求人」がありません」と書くため）。 */
  missingSubfolders: string[];
  durationMs: number;
}

export interface RunOneDriveSyncRetryOptions {
  /** false なら DB も Graph も一切書かず、拾う対象の件数だけ数える。 */
  execute: boolean;
  limit?: number;
  concurrency?: number;
  budgetMs?: number;
  now?: Date;
  log?: (message: string) => void;
}

/** onedrive_sync_logs から拾い直し対象を取り出して1件ずつ試す。例外は投げない設計ではないので呼び出し側で捕捉する。 */
export async function runOneDriveSyncRetry(
  opts: RunOneDriveSyncRetryOptions,
): Promise<OneDriveSyncRetrySummary> {
  const startedAt = Date.now();
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? ONEDRIVE_RETRY_DEFAULT_LIMIT;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? ONEDRIVE_RETRY_CONCURRENCY, 3));
  const budgetMs = opts.budgetMs ?? ONEDRIVE_RETRY_DEFAULT_BUDGET_MS;
  const log = opts.log ?? (() => {});

  const where = buildOneDriveRetryWhere(now);

  const eligible = await prisma.oneDriveSyncLog.count({ where });
  const rows = await prisma.oneDriveSyncLog.findMany({
    where,
    // 古いものから。溜まった分が後回しにされ続けるのを防ぐ。
    orderBy: [{ createdAt: "asc" }],
    take: limit,
    select: {
      id: true,
      candidateFileId: true,
      candidateId: true,
      status: true,
      skipReason: true,
      attemptCount: true,
      candidateFile: { select: { category: true, fileName: true } },
    },
  });

  log(
    `[onedrive-retry] 対象 ${eligible}件 / 今回 ${rows.length}件 ` +
      `(limit=${limit} concurrency=${concurrency} mode=${opts.execute ? "execute" : "dry-run"} ` +
      `syncEnabled=${isOneDriveSyncEnabled()})`,
  );

  const byStatus: Record<string, number> = {};
  const bySkipReason: Record<string, number> = {};
  // 理由ごとに求職者を重複なく数えるため Set で持つ（同じ人の3ファイルは「1名」）。
  const candidatesByReason = new Map<OneDriveSyncSkipReason, Set<string>>();
  const filesByReason = new Map<OneDriveSyncSkipReason, number>();
  const missingSubfolders = new Set<string>();
  let processed = 0;
  let success = 0;
  let givenUp = 0;

  if (!opts.execute) {
    // DRY-RUN: どういう内訳の行を拾うのかだけ返す（現在値の内訳。試行はしない）。
    for (const row of rows) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      const key = row.skipReason ?? "-";
      bySkipReason[key] = (bySkipReason[key] ?? 0) + 1;
    }
    return {
      mode: "dry-run",
      syncEnabled: isOneDriveSyncEnabled(),
      eligible,
      picked: rows.length,
      processed: 0,
      deferred: eligible - rows.length,
      success: 0,
      givenUp: 0,
      byStatus,
      bySkipReason,
      needsAttention: [],
      missingSubfolders: [],
      durationMs: Date.now() - startedAt,
    };
  }

  let cursor = 0;
  let timedOut = false;

  const worker = async () => {
    for (;;) {
      if (Date.now() - startedAt > budgetMs) {
        timedOut = true;
        return;
      }
      const index = cursor++;
      if (index >= rows.length) return;
      const row = rows[index];

      const fromSkipped = row.status === OneDriveSyncStatus.SKIPPED;

      // runOneDriveSyncForFile は例外を投げない。status / skipReason / siblingFolders は
      // 内部の upsert で既に書かれており、ここで足すのは再試行制御の3列だけ。
      const result = await runOneDriveSyncForFile({
        candidateFileId: row.candidateFileId,
        deferAttemptBookkeeping: true,
      });

      const book = decideRetryBookkeeping({
        fromSkipped,
        previousAttemptCount: row.attemptCount,
        outcomeStatus: result.status,
        graphAttempted: result.countAttempt,
        now: new Date(),
      });

      try {
        await prisma.oneDriveSyncLog.update({
          where: { id: row.id },
          data: {
            attemptCount: book.attemptCount,
            // 結果に関わらず「今夜見に行った」を刻む。SKIPPED のクールダウンの起点。
            lastAttemptedAt: new Date(),
            nextRetryAt: book.nextRetryAt,
            ...(book.statusOverride ? { status: book.statusOverride } : {}),
          },
        });
      } catch (e) {
        // 行が消えた（CandidateFile 削除）等。集計だけ進めて続行する。
        log(
          `[onedrive-retry] 記録の更新に失敗（続行）: ${row.candidateFileId} ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }

      const finalStatus = book.statusOverride ?? result.status;
      processed++;
      byStatus[finalStatus] = (byStatus[finalStatus] ?? 0) + 1;
      const reasonKey = result.skipReason ?? "-";
      bySkipReason[reasonKey] = (bySkipReason[reasonKey] ?? 0) + 1;

      if (finalStatus === OneDriveSyncStatus.SUCCESS) success++;
      if (finalStatus === OneDriveSyncStatus.GIVEN_UP) givenUp++;

      if (
        finalStatus === OneDriveSyncStatus.SKIPPED &&
        result.skipReason &&
        ONEDRIVE_CA_ACTION_REASONS.includes(result.skipReason)
      ) {
        const set = candidatesByReason.get(result.skipReason) ?? new Set<string>();
        set.add(row.candidateId);
        candidatesByReason.set(result.skipReason, set);
        filesByReason.set(result.skipReason, (filesByReason.get(result.skipReason) ?? 0) + 1);

        if (result.skipReason === OneDriveSyncSkipReason.NO_SUBFOLDER) {
          const sub = ONEDRIVE_SUBFOLDER_BY_CATEGORY[row.candidateFile.category];
          if (sub) missingSubfolders.add(sub);
        }
      }

      log(
        `[onedrive-retry] ${finalStatus}${result.skipReason ? `/${result.skipReason}` : ""} ` +
          `att=${book.attemptCount} ${row.candidateFile.fileName}`,
      );
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (timedOut) {
    log(
      `[onedrive-retry] 実時間の上限（${budgetMs}ms）に達したため打ち切りました。残りは次回に回します。`,
    );
  }

  const needsAttention: OneDriveRetryReasonBucket[] = ONEDRIVE_CA_ACTION_REASONS.filter((r) =>
    filesByReason.has(r),
  ).map((reason) => ({
    reason,
    files: filesByReason.get(reason) ?? 0,
    candidates: candidatesByReason.get(reason)?.size ?? 0,
  }));

  return {
    mode: "execute",
    syncEnabled: isOneDriveSyncEnabled(),
    eligible,
    picked: rows.length,
    processed,
    // limit で切った分 + 実時間上限で触らなかった分
    deferred: eligible - rows.length + (rows.length - processed),
    success,
    givenUp,
    byStatus,
    bySkipReason,
    needsAttention,
    missingSubfolders: [...missingSubfolders],
    durationMs: Date.now() - startedAt,
  };
}
