/**
 * T-168: 空振り（取り込み対象メール0件）で RUNNING のまま残った過去の RpaExecutionBatch を
 * NO_TARGET にクローズする一括クリーンアップ。
 *
 * 対象条件（全て満たすもの）:
 *   - status = "RUNNING"
 *   - 紐づく MynaviRpaProcessingLog が 0件
 *   - startedAt が現在時刻から STALE_MINUTES（既定30分）以上前
 *   - batchId が T-167 検証用ダミー "t167-verify-20260818" ではない（二重の安全策）
 *
 * 更新内容: status = "NO_TARGET" / finishedAt = 現在時刻。他カラムは触らない。
 *
 * 触らないもの:
 *   - 処理ログが1件以上あるバッチ（28件。原因調査のため RUNNING のまま残す）
 *   - COMPLETED / FAILED バッチ
 *   RUNNING → COMPLETED への変換は last-execution のメール取得ウィンドウを壊すため行わない。
 *
 * idempotent（再実行しても対象0件で正常終了）。
 *
 * 実行: npx tsx scripts/close-no-target-batches-t168.ts            # DRY-RUN（既定）
 *       npx tsx scripts/close-no-target-batches-t168.ts --execute  # 本実行
 *   環境変数 RPA_NO_TARGET_STALE_MINUTES でしきい値（分）を上書き可能。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import {
  RPA_BATCH_STATUS_NO_TARGET,
  T167_VERIFY_BATCH_ID,
  buildNoTargetWhere,
  getNoTargetStaleMinutes,
} from "@/lib/mynavi-rpa/no-target";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const EXECUTE = process.argv.includes("--execute");
const MODE = EXECUTE ? "EXECUTE" : "DRY-RUN";
const CHUNK = 1000;

function iso(d: Date | null): string {
  return d ? d.toISOString() : "—";
}

async function main() {
  const now = new Date();
  const staleMinutes = getNoTargetStaleMinutes();
  const where = buildNoTargetWhere({
    now,
    staleMinutes,
    excludeBatchIds: [T167_VERIFY_BATCH_ID],
  });

  console.log(`=== T-168 空振りRPAバッチ NO_TARGET クローズ (mode=${MODE}) ===`);
  console.log(`now(UTC)        : ${iso(now)}`);
  console.log(`staleMinutes    : ${staleMinutes}`);
  console.log(
    `threshold(UTC)  : ${iso(new Date(now.getTime() - staleMinutes * 60 * 1000))} より前に開始したもの`,
  );
  console.log(`除外batchId     : ${T167_VERIFY_BATCH_ID}`);
  console.log("");

  // 事前スナップショット
  const [runningAll, runningWithLogs, noTargetBefore, completedBefore, failedBefore] =
    await Promise.all([
      prisma.rpaExecutionBatch.count({ where: { status: "RUNNING" } }),
      prisma.rpaExecutionBatch.count({
        where: { status: "RUNNING", processingLogs: { some: {} } },
      }),
      prisma.rpaExecutionBatch.count({ where: { status: RPA_BATCH_STATUS_NO_TARGET } }),
      prisma.rpaExecutionBatch.count({ where: { status: "COMPLETED" } }),
      prisma.rpaExecutionBatch.count({ where: { status: "FAILED" } }),
    ]);
  console.log("--- 実行前スナップショット ---");
  console.log(`RUNNING           : ${runningAll}（うち処理ログあり ${runningWithLogs}）`);
  console.log(`NO_TARGET         : ${noTargetBefore}`);
  console.log(`COMPLETED         : ${completedBefore}`);
  console.log(`FAILED            : ${failedBefore}`);
  console.log("");

  const targetCount = await prisma.rpaExecutionBatch.count({ where });
  console.log(`--- 対象件数: ${targetCount} 件 ---`);

  if (targetCount === 0) {
    console.log("対象なし。何もせず終了します。");
    return;
  }

  const head = await prisma.rpaExecutionBatch.findMany({
    where,
    orderBy: { startedAt: "asc" },
    take: 10,
    select: { id: true, startedAt: true, machineNumber: true },
  });
  const tail = await prisma.rpaExecutionBatch.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: 10,
    select: { id: true, startedAt: true, machineNumber: true },
  });

  console.log("先頭10件（startedAt 昇順）:");
  for (const b of head) console.log(`  ${b.id}  ${iso(b.startedAt)}  ${b.machineNumber}号機`);
  console.log("末尾10件（startedAt 降順）:");
  for (const b of tail) console.log(`  ${b.id}  ${iso(b.startedAt)}  ${b.machineNumber}号機`);
  console.log("");

  if (!EXECUTE) {
    console.log("DRY-RUN のため更新は行いません。--execute で本実行してください。");
    return;
  }

  // 本実行: 条件を全て WHERE に含めた updateMany を 1,000件ずつ
  let updated = 0;
  for (let i = 1; ; i++) {
    const res = await prisma.rpaExecutionBatch.updateMany({
      where: buildNoTargetWhere({
        now,
        staleMinutes,
        excludeBatchIds: [T167_VERIFY_BATCH_ID],
      }),
      data: { status: RPA_BATCH_STATUS_NO_TARGET, finishedAt: now },
      limit: CHUNK,
    });
    updated += res.count;
    console.log(`  chunk#${i}: ${res.count}件 更新（累計 ${updated}）`);
    if (res.count === 0) break;
  }

  console.log("");
  console.log(`--- 更新合計: ${updated} 件 ---`);

  const [runningAfter, runningWithLogsAfter, noTargetAfter, completedAfter, failedAfter] =
    await Promise.all([
      prisma.rpaExecutionBatch.count({ where: { status: "RUNNING" } }),
      prisma.rpaExecutionBatch.count({
        where: { status: "RUNNING", processingLogs: { some: {} } },
      }),
      prisma.rpaExecutionBatch.count({ where: { status: RPA_BATCH_STATUS_NO_TARGET } }),
      prisma.rpaExecutionBatch.count({ where: { status: "COMPLETED" } }),
      prisma.rpaExecutionBatch.count({ where: { status: "FAILED" } }),
    ]);
  const dummy = await prisma.rpaExecutionBatch.findUnique({
    where: { id: T167_VERIFY_BATCH_ID },
    select: { id: true, status: true, finishedAt: true },
  });

  console.log("--- 実行後スナップショット ---");
  console.log(`RUNNING           : ${runningAfter}（うち処理ログあり ${runningWithLogsAfter}）`);
  console.log(`NO_TARGET         : ${noTargetAfter}`);
  console.log(`COMPLETED         : ${completedAfter}`);
  console.log(`FAILED            : ${failedAfter}`);
  console.log(
    `${T167_VERIFY_BATCH_ID}: ${dummy ? `${dummy.status} / finishedAt=${iso(dummy.finishedAt)}` : "(見つかりません)"}`,
  );

  if (runningWithLogsAfter !== runningWithLogs) {
    console.error(
      `!!! 警告: 処理ログありRUNNINGの件数が変化しました（${runningWithLogs} → ${runningWithLogsAfter}）`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
