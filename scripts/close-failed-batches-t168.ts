/**
 * T-168 Step4: 処理ログがあるのに RUNNING のまま残った過去の RpaExecutionBatch を
 * FAILED にクローズする一括更新。
 *
 * 対象条件（全て満たすもの）:
 *   - status = "RUNNING"
 *   - 紐づく MynaviRpaProcessingLog が 1件以上
 *   - startedAt が現在時刻から STALE_MINUTES（既定30分）以上前
 *   - batchId が T-167 検証用ダミー "t167-verify-20260818" ではない（明示除外・温存する）
 *
 * 更新内容:
 *   status       = "FAILED"
 *   finishedAt   = 最後の処理ログの processedAt（現在時刻ではない。実際に止まった時刻を残す）
 *   errorMessage = "RPA異常終了により未完了（自動判定）"
 *   他カラムは触らない。
 *
 * 触らないもの:
 *   - 処理ログ0件のバッチ（Step2 で NO_TARGET 化済み）
 *   - COMPLETED / NO_TARGET バッチ
 *   - 応募者（Candidate）・処理ログ（MynaviRpaProcessingLog）
 *   完了通知（LINE WORKS）も発火させない（後から畳んでいるだけなので通知はノイズ）。
 *
 * idempotent（再実行しても対象0件で正常終了）。
 *
 * 実行: npx tsx scripts/close-failed-batches-t168.ts            # DRY-RUN（既定）
 *       npx tsx scripts/close-failed-batches-t168.ts --execute  # 本実行
 *   環境変数 RPA_NO_TARGET_STALE_MINUTES でしきい値（分）を上書き可能（Step2 と共通）。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import {
  RPA_BATCH_STATUS_FAILED,
  RPA_BATCH_STATUS_NO_TARGET,
  RPA_STALE_FAILED_ERROR_MESSAGE,
  T167_VERIFY_BATCH_ID,
  buildStaleFailedWhere,
  closeStaleFailedBatches,
  getNoTargetStaleMinutes,
  noTargetThreshold,
} from "@/lib/mynavi-rpa/no-target";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const EXECUTE = process.argv.includes("--execute");
const MODE = EXECUTE ? "EXECUTE" : "DRY-RUN";

function iso(d: Date | null | undefined): string {
  return d ? d.toISOString() : "—";
}

/** 表示用の JST 文字列（罠#17 のため toISOString() 系は使わない） */
function jst(d: Date | null | undefined): string {
  return d ? d.toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }) : "—";
}

async function snapshot() {
  const [running, runningWithLogs, failed, noTarget, completed, logCount] =
    await Promise.all([
      prisma.rpaExecutionBatch.count({ where: { status: "RUNNING" } }),
      prisma.rpaExecutionBatch.count({
        where: { status: "RUNNING", processingLogs: { some: {} } },
      }),
      prisma.rpaExecutionBatch.count({ where: { status: RPA_BATCH_STATUS_FAILED } }),
      prisma.rpaExecutionBatch.count({ where: { status: RPA_BATCH_STATUS_NO_TARGET } }),
      prisma.rpaExecutionBatch.count({ where: { status: "COMPLETED" } }),
      prisma.mynaviRpaProcessingLog.count(),
    ]);
  return { running, runningWithLogs, failed, noTarget, completed, logCount };
}

function printSnapshot(label: string, s: Awaited<ReturnType<typeof snapshot>>) {
  console.log(`--- ${label} ---`);
  console.log(`RUNNING            : ${s.running}（うち処理ログあり ${s.runningWithLogs}）`);
  console.log(`FAILED             : ${s.failed}`);
  console.log(`NO_TARGET          : ${s.noTarget}`);
  console.log(`COMPLETED          : ${s.completed}`);
  console.log(`処理ログ総数       : ${s.logCount}`);
  console.log("");
}

async function main() {
  const now = new Date();
  const staleMinutes = getNoTargetStaleMinutes();
  const where = buildStaleFailedWhere({ now, staleMinutes });

  console.log(`=== T-168 Step4 異常終了RPAバッチ FAILED クローズ (mode=${MODE}) ===`);
  console.log(`now(UTC)        : ${iso(now)}  / JST ${jst(now)}`);
  console.log(`staleMinutes    : ${staleMinutes}`);
  console.log(
    `threshold(UTC)  : ${iso(noTargetThreshold(now, staleMinutes))} より前に開始したもの`,
  );
  console.log(`除外batchId     : ${T167_VERIFY_BATCH_ID}`);
  console.log(`errorMessage    : ${RPA_STALE_FAILED_ERROR_MESSAGE}`);
  console.log("");

  const before = await snapshot();
  printSnapshot("実行前スナップショット", before);

  const targets = await prisma.rpaExecutionBatch.findMany({
    where,
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      startedAt: true,
      machineNumber: true,
      _count: { select: { processingLogs: true } },
      processingLogs: {
        orderBy: { processedAt: "desc" },
        take: 1,
        select: { processedAt: true },
      },
    },
  });

  console.log(`--- 対象件数: ${targets.length} 件（全件表示・JST） ---`);
  console.log(
    "  batchId                      | 開始(JST)           | ログ数 | 最終ログ(JST)",
  );
  for (const t of targets) {
    console.log(
      `  ${t.id.padEnd(28)} | ${jst(t.startedAt)} | ${String(t._count.processingLogs).padStart(5)} | ${jst(t.processingLogs[0]?.processedAt)}`,
    );
  }
  console.log("");

  if (targets.length === 0) {
    console.log("対象なし。何もせず終了します。");
    return;
  }

  if (!EXECUTE) {
    console.log("DRY-RUN のため更新は行いません。--execute で本実行してください。");
    return;
  }

  // 本実行: 製品コード（batch-start）と同じ関数を使う
  const res = await closeStaleFailedBatches(prisma, {
    now,
    staleMinutes,
    limit: targets.length,
  });
  console.log(`--- 更新合計: ${res.count} 件 ---`);
  console.log("");

  const after = await snapshot();
  printSnapshot("実行後スナップショット", after);

  const dummy = await prisma.rpaExecutionBatch.findUnique({
    where: { id: T167_VERIFY_BATCH_ID },
    select: { id: true, status: true, finishedAt: true },
  });
  console.log(
    `${T167_VERIFY_BATCH_ID}: ${dummy ? `${dummy.status} / finishedAt=${iso(dummy.finishedAt)}` : "(見つかりません)"}`,
  );

  const sample = await prisma.rpaExecutionBatch.findMany({
    where: { status: RPA_BATCH_STATUS_FAILED },
    orderBy: { startedAt: "asc" },
    take: 3,
    select: { id: true, status: true, startedAt: true, finishedAt: true, errorMessage: true },
  });
  console.log("");
  console.log("FAILED 化した先頭3件（JST）:");
  for (const s of sample) {
    console.log(
      `  ${s.id}  開始=${jst(s.startedAt)}  完了=${jst(s.finishedAt)}  msg=${s.errorMessage ?? "—"}`,
    );
  }

  // 不変であるべきものの検証
  if (after.logCount !== before.logCount) {
    console.error(
      `!!! 警告: 処理ログ件数が変化しました（${before.logCount} → ${after.logCount}）`,
    );
  }
  if (after.completed !== before.completed) {
    console.error(
      `!!! 警告: COMPLETED 件数が変化しました（${before.completed} → ${after.completed}）`,
    );
  }
  if (after.noTarget !== before.noTarget) {
    console.error(
      `!!! 警告: NO_TARGET 件数が変化しました（${before.noTarget} → ${after.noTarget}）`,
    );
  }
  if (dummy?.status !== "RUNNING") {
    console.error(`!!! 警告: ${T167_VERIFY_BATCH_ID} が RUNNING ではありません`);
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
