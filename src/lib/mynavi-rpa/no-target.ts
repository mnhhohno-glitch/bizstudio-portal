import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * T-168: 空振り（取り込み対象メール0件）で終わった RPA バッチの自動クローズ。
 *
 * PAD 側は対象メールが0件のとき `batch-finish` を呼ばずにフローを終了するため、
 * `batch-start` で作られた RpaExecutionBatch が RUNNING のまま残り続ける。
 * portal 側で「一定時間経過しても RUNNING かつ処理ログ0件」のバッチを NO_TARGET にして畳む。
 *
 * COMPLETED にしてはいけない: `last-execution` が最新 COMPLETED の startedAt を
 * メール取得ウィンドウの基点として返すため、空振りバッチを COMPLETED にすると
 * 取りこぼしが発生する（Step1 調査報告 6-3）。
 */

/** 取り込み対象なしで終了したバッチの状態値 */
export const RPA_BATCH_STATUS_NO_TARGET = "NO_TARGET";

/** T-167 の検証用ダミーバッチ。処理ログありなので条件上も対象外だが二重の安全策として除外する */
export const T167_VERIFY_BATCH_ID = "t167-verify-20260818";

/** 既定の経過時間しきい値（分）。PAD は5分間隔で起動するため 30分あれば実行中の取り違えは起きない */
export const DEFAULT_NO_TARGET_STALE_MINUTES = 30;

/** 1回の掃除で更新する上限件数 */
export const DEFAULT_NO_TARGET_CLOSE_LIMIT = 500;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getNoTargetStaleMinutes(): number {
  return readPositiveIntEnv(
    "RPA_NO_TARGET_STALE_MINUTES",
    DEFAULT_NO_TARGET_STALE_MINUTES,
  );
}

export function getNoTargetCloseLimit(): number {
  return readPositiveIntEnv("RPA_NO_TARGET_CLOSE_LIMIT", DEFAULT_NO_TARGET_CLOSE_LIMIT);
}

export type NoTargetWhereOptions = {
  /** 判定基準時刻（既定: 現在時刻） */
  now?: Date;
  /** 経過時間しきい値（分。既定: 環境変数 or 30） */
  staleMinutes?: number;
  /** 除外するバッチID（今作成したバッチ／検証用ダミー等） */
  excludeBatchIds?: string[];
};

/**
 * 空振りバッチの判定条件。
 * - status = RUNNING
 * - 紐づく処理ログが0件
 * - startedAt が staleMinutes 以上前
 * - excludeBatchIds に含まれない
 *
 * 日時比較は UTC instant 同士（経過時間の比較なので JST 変換は不要）。
 */
export function buildNoTargetWhere(
  opts: NoTargetWhereOptions = {},
): Prisma.RpaExecutionBatchWhereInput {
  const now = opts.now ?? new Date();
  const staleMinutes = opts.staleMinutes ?? getNoTargetStaleMinutes();
  const threshold = new Date(now.getTime() - staleMinutes * 60 * 1000);
  const exclude = (opts.excludeBatchIds ?? []).filter(Boolean);

  const where: Prisma.RpaExecutionBatchWhereInput = {
    status: "RUNNING",
    startedAt: { lt: threshold },
    processingLogs: { none: {} },
  };
  if (exclude.length > 0) where.id = { notIn: exclude };
  return where;
}

/** buildNoTargetWhere と同じ条件のしきい値時刻を返す（ログ表示用） */
export function noTargetThreshold(now: Date, staleMinutes: number): Date {
  return new Date(now.getTime() - staleMinutes * 60 * 1000);
}

type BatchClient = Pick<PrismaClient, "rpaExecutionBatch">;

export type CloseNoTargetResult = {
  count: number;
  staleMinutes: number;
  limit: number;
  threshold: Date;
};

/**
 * 空振りバッチを NO_TARGET にクローズする。
 * SELECT→UPDATE のレースを避けるため条件を全て WHERE に含めた updateMany 1発で行う。
 */
export async function closeStaleNoTargetBatches(
  client: BatchClient,
  opts: NoTargetWhereOptions & { limit?: number } = {},
): Promise<CloseNoTargetResult> {
  const now = opts.now ?? new Date();
  const staleMinutes = opts.staleMinutes ?? getNoTargetStaleMinutes();
  const limit = opts.limit ?? getNoTargetCloseLimit();

  const res = await client.rpaExecutionBatch.updateMany({
    where: buildNoTargetWhere({ ...opts, now, staleMinutes }),
    data: { status: RPA_BATCH_STATUS_NO_TARGET, finishedAt: now },
    limit,
  });

  return {
    count: res.count,
    staleMinutes,
    limit,
    threshold: noTargetThreshold(now, staleMinutes),
  };
}

// ---------------------------------------------------------------------------
// T-168 Step4: 処理ログがあるのに RUNNING のまま残ったバッチの FAILED 化
// ---------------------------------------------------------------------------

/**
 * 「処理ログが1件以上あるのに RUNNING のまま」＝ PAD（RPA）が処理途中で異常終了し
 * `batch-finish` を呼べなかったケース。空振り（NO_TARGET）とは原因も意味も違うため、
 * 別の状態値 FAILED に畳む。人が見るべき記録なので一覧の既定フィルタでは隠さない。
 *
 * 完了日時には「最後の処理ログの processedAt」を入れる（現在時刻ではない）。
 * 後から気づいて畳んでいるだけなので、実際に処理が止まった時刻を残す。
 */
export const RPA_BATCH_STATUS_FAILED = "FAILED";

/** 自動 FAILED 化したバッチに入れる固定文言 */
export const RPA_STALE_FAILED_ERROR_MESSAGE = "RPA異常終了により未完了（自動判定）";

/**
 * 異常終了バッチの判定条件。NO_TARGET 側と唯一違うのは processingLogs の有無。
 * 誤って逆側を更新しないよう、WHERE も updateMany も NO_TARGET とは完全に分けている。
 *
 * - status = RUNNING
 * - 紐づく処理ログが1件以上
 * - startedAt が staleMinutes 以上前
 * - T-167 検証用ダミー および excludeBatchIds に含まれない
 */
export function buildStaleFailedWhere(
  opts: NoTargetWhereOptions = {},
): Prisma.RpaExecutionBatchWhereInput {
  const now = opts.now ?? new Date();
  const staleMinutes = opts.staleMinutes ?? getNoTargetStaleMinutes();
  const threshold = noTargetThreshold(now, staleMinutes);
  const exclude = Array.from(
    new Set([...(opts.excludeBatchIds ?? []).filter(Boolean), T167_VERIFY_BATCH_ID]),
  );

  return {
    status: "RUNNING",
    startedAt: { lt: threshold },
    processingLogs: { some: {} },
    id: { notIn: exclude },
  };
}

export type CloseStaleFailedResult = {
  count: number;
  staleMinutes: number;
  limit: number;
  threshold: Date;
};

/**
 * 異常終了バッチを FAILED にクローズする。
 *
 * finishedAt が行ごとに違う（最後の処理ログの processedAt）ため updateMany 1発では書けない。
 * 対象を引いてから1件ずつ `updateMany({ where: { id, status: "RUNNING" } })` で更新することで、
 * 引いた後に `batch-finish` が届いて COMPLETED になった行を上書きしないようにしている。
 *
 * 完了通知（LINE WORKS）は発火させない。リアルタイムの完了報告ではなく、
 * 後から気づいて畳んでいるだけなので通知はノイズにしかならない。
 */
export async function closeStaleFailedBatches(
  client: BatchClient,
  opts: NoTargetWhereOptions & { limit?: number } = {},
): Promise<CloseStaleFailedResult> {
  const now = opts.now ?? new Date();
  const staleMinutes = opts.staleMinutes ?? getNoTargetStaleMinutes();
  const limit = opts.limit ?? getNoTargetCloseLimit();

  const targets = await client.rpaExecutionBatch.findMany({
    where: buildStaleFailedWhere({ ...opts, now, staleMinutes }),
    orderBy: { startedAt: "asc" },
    take: limit,
    select: {
      id: true,
      processingLogs: {
        orderBy: { processedAt: "desc" },
        take: 1,
        select: { processedAt: true },
      },
    },
  });

  let count = 0;
  for (const t of targets) {
    const lastProcessedAt = t.processingLogs[0]?.processedAt;
    if (!lastProcessedAt) continue; // 条件上ありえないが念のため
    const res = await client.rpaExecutionBatch.updateMany({
      where: { id: t.id, status: "RUNNING" },
      data: {
        status: RPA_BATCH_STATUS_FAILED,
        finishedAt: lastProcessedAt,
        errorMessage: RPA_STALE_FAILED_ERROR_MESSAGE,
      },
    });
    count += res.count;
  }

  return {
    count,
    staleMinutes,
    limit,
    threshold: noTargetThreshold(now, staleMinutes),
  };
}
