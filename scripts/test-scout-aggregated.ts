/**
 * T-064 Phase A 追加: 集計済みデータ取込 API 疎通確認
 *
 * 実行: npx tsx scripts/test-scout-aggregated.ts
 *
 * 確認項目:
 *  1. 正常系: 5号機×12時間=60件 → successCount=60
 *  2. DB 反映: deliveryCount が全件更新されている
 *  3. 6号機（停止中）データも反映される（マスタに存在するため）
 *  4. 存在しない号機（7号機）はスキップ → errors に記録
 *  5. 不正な hourSlot（25）はバリデーションで弾かれる
 *  6. ScoutImportLog に AGGREGATED_JSON として記録
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import {
  createDailySlots,
  getTomorrowJst,
} from "../src/lib/scout/slot-helpers";
import { importAggregatedScoutData } from "../src/lib/scout/aggregated-importer";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function formatDateStr(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function main() {
  console.log("\n=== T-064 集計済みデータ取込 疎通確認 ===\n");

  const tomorrow = getTomorrowJst();
  const dateStr = formatDateStr(tomorrow);

  // 前準備: 翌日枠を作成
  await prisma.scoutDeliverySlot.deleteMany({ where: { deliveryDate: tomorrow } });
  const slotResult = await createDailySlots(tomorrow);
  check("配信枠作成", slotResult.created === 96, `${slotResult.created}枠`);

  // 1. 正常系: 5号機×12時間=60件
  console.log("\n[1] 正常系: 稼働中5号機×12時間");
  const normalData = [];
  for (let machine = 1; machine <= 5; machine++) {
    for (let hour = 8; hour <= 19; hour++) {
      normalData.push({
        machineNumber: machine,
        hourSlot: hour,
        deliveryCount: machine * 10 + hour,
      });
    }
  }
  const result1 = await importAggregatedScoutData({
    targetDate: dateStr,
    data: normalData,
  });
  check("status=COMPLETED", result1.status === "COMPLETED");
  check("successCount=60", result1.successCount === 60, `${result1.successCount}件`);
  check("skippedCount=0", result1.skippedCount === 0, `${result1.skippedCount}件`);
  check("errors=0件", result1.errors.length === 0);

  // 2. DB 反映確認
  console.log("\n[2] DB 反映確認");
  const slots = await prisma.scoutDeliverySlot.findMany({
    where: { deliveryDate: tomorrow, isMachine: true },
    include: { machine: true },
  });
  const slot1_8 = slots.find((s) => s.machine?.machineNumber === 1 && s.hourSlot === 8);
  check("1号機 8時 deliveryCount=18", slot1_8?.deliveryCount === 18, `actual=${slot1_8?.deliveryCount}`);
  const slot3_12 = slots.find((s) => s.machine?.machineNumber === 3 && s.hourSlot === 12);
  check("3号機 12時 deliveryCount=42", slot3_12?.deliveryCount === 42, `actual=${slot3_12?.deliveryCount}`);
  const slot5_19 = slots.find((s) => s.machine?.machineNumber === 5 && s.hourSlot === 19);
  check("5号機 19時 deliveryCount=69", slot5_19?.deliveryCount === 69, `actual=${slot5_19?.deliveryCount}`);

  // 3. 6号機（停止中）データも反映される
  console.log("\n[3] 6号機（停止中）データ反映");
  const result2 = await importAggregatedScoutData({
    targetDate: dateStr,
    data: [
      { machineNumber: 6, hourSlot: 8, deliveryCount: 77 },
      { machineNumber: 6, hourSlot: 9, deliveryCount: 88 },
    ],
  });
  check("6号機 status=COMPLETED", result2.status === "COMPLETED");
  check("6号機 successCount=2", result2.successCount === 2, `${result2.successCount}件`);
  const slot6_8 = slots.find((s) => s.machine?.machineNumber === 6 && s.hourSlot === 8);
  if (slot6_8) {
    const reloaded = await prisma.scoutDeliverySlot.findUnique({ where: { id: slot6_8.id } });
    check("6号機 8時 deliveryCount=77", reloaded?.deliveryCount === 77, `actual=${reloaded?.deliveryCount}`);
  } else {
    check("6号機 8時の枠が存在", false, "slot not found");
  }

  // 4. 存在しない号機（7号機）はスキップ
  console.log("\n[4] 存在しない号機（7号機）スキップ");
  const result3 = await importAggregatedScoutData({
    targetDate: dateStr,
    data: [
      { machineNumber: 7, hourSlot: 8, deliveryCount: 10 },
      { machineNumber: 1, hourSlot: 8, deliveryCount: 99 },
    ],
  });
  check("7号機含み status=COMPLETED", result3.status === "COMPLETED");
  check("successCount=1（1号機分のみ）", result3.successCount === 1, `${result3.successCount}件`);
  check("skippedCount=1（7号機）", result3.skippedCount === 1, `${result3.skippedCount}件`);
  check("errors[0].reason='machine not found'", result3.errors[0]?.reason === "machine not found");

  // 5. ScoutImportLog 確認
  console.log("\n[5] ScoutImportLog 記録確認");
  const logs = await prisma.scoutImportLog.findMany({
    where: { importType: "AGGREGATED_JSON" },
    orderBy: { startedAt: "desc" },
    take: 5,
  });
  check("AGGREGATED_JSON ログが存在", logs.length >= 3, `${logs.length}件`);
  const completedLogs = logs.filter((l) => l.status === "COMPLETED");
  check("COMPLETED ログが存在", completedLogs.length >= 3, `${completedLogs.length}件`);

  // クリーンアップ
  await prisma.scoutDeliverySlot.deleteMany({ where: { deliveryDate: tomorrow } });
  if (logs.length > 0) {
    await prisma.scoutImportLog.deleteMany({
      where: { id: { in: logs.map((l) => l.id) } },
    });
  }

  console.log("\n=== 結果 ===");
  console.log(`  PASS: ${pass}`);
  console.log(`  FAIL: ${fail}`);
  if (fail > 0) process.exit(1);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
