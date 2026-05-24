/**
 * T-064: 集計済みデータ取込 autoCreateSlots オプション疎通確認
 *
 * 実行: npx tsx scripts/test-scout-aggregated-auto-create.ts
 *
 * 確認項目:
 *  1. 配信枠未作成の過去日に autoCreateSlots=true でデータ送信 → 枠自動作成 + 反映
 *  2. 同じ日に再度送信 → 枠は既存なので自動作成スキップ、データは上書き
 *  3. autoCreateSlots=false（デフォルト）で枠なし日に送信 → エラー（既存挙動）
 *  4. createSlotsForDate の重複防止確認
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { importAggregatedScoutData } from "../src/lib/scout/aggregated-importer";
import { createSlotsForDate } from "../src/lib/scout/slot-creator";

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

const TEST_DATE = "2026-01-15";

async function cleanup() {
  const date = new Date(TEST_DATE + "T00:00:00Z");
  await prisma.scoutDeliverySlot.deleteMany({ where: { deliveryDate: date } });
}

async function main() {
  console.log("\n=== T-064 autoCreateSlots 疎通確認 ===\n");

  // 前準備: テスト日の枠を削除
  await cleanup();

  // 1. autoCreateSlots=true で枠未作成日にデータ送信
  console.log("[1] autoCreateSlots=true — 枠未作成日にデータ送信");
  const data1 = [];
  for (let machine = 1; machine <= 5; machine++) {
    for (let hour = 8; hour <= 19; hour++) {
      data1.push({ machineNumber: machine, hourSlot: hour, deliveryCount: machine * 10 + hour });
    }
  }

  const result1 = await importAggregatedScoutData({
    targetDate: TEST_DATE,
    data: data1,
    autoCreateSlots: true,
  });
  check("status=COMPLETED", result1.status === "COMPLETED");
  check("successCount=60", result1.successCount === 60, `${result1.successCount}件`);
  check("slotsAutoCreated=96", result1.slotsAutoCreated === 96, `${result1.slotsAutoCreated}枠`);

  // DB 反映確認
  const date = new Date(TEST_DATE + "T00:00:00Z");
  const slots = await prisma.scoutDeliverySlot.findMany({
    where: { deliveryDate: date, isMachine: true },
    include: { machine: true },
  });
  const slot1_8 = slots.find((s) => s.machine?.machineNumber === 1 && s.hourSlot === 8);
  check("1号機 8時 deliveryCount=18", slot1_8?.deliveryCount === 18, `actual=${slot1_8?.deliveryCount}`);

  const allSlots = await prisma.scoutDeliverySlot.findMany({ where: { deliveryDate: date } });
  check("全枠96件存在", allSlots.length === 96, `${allSlots.length}件`);

  // 2. 同じ日に再度送信 — 枠は既存、データ上書き
  console.log("\n[2] 同じ日に再度送信 — 枠既存、データ上書き");
  const data2 = [{ machineNumber: 1, hourSlot: 8, deliveryCount: 999 }];
  const result2 = await importAggregatedScoutData({
    targetDate: TEST_DATE,
    data: data2,
    autoCreateSlots: true,
  });
  check("status=COMPLETED", result2.status === "COMPLETED");
  check("successCount=1", result2.successCount === 1, `${result2.successCount}件`);
  check("slotsAutoCreated=undefined（枠既存）", result2.slotsAutoCreated === undefined, `${result2.slotsAutoCreated}`);

  const reloaded = await prisma.scoutDeliverySlot.findUnique({ where: { id: slot1_8!.id } });
  check("1号機 8時 deliveryCount=999 に上書き", reloaded?.deliveryCount === 999, `actual=${reloaded?.deliveryCount}`);

  // 3. autoCreateSlots=false で枠なし日に送信 → エラー
  console.log("\n[3] autoCreateSlots=false — 枠なし日にデータ送信 → エラー");
  await cleanup();
  let errorCaught = false;
  try {
    await importAggregatedScoutData({
      targetDate: TEST_DATE,
      data: [{ machineNumber: 1, hourSlot: 8, deliveryCount: 10 }],
      autoCreateSlots: false,
    });
  } catch (e) {
    errorCaught = true;
    const msg = e instanceof Error ? e.message : "";
    check("エラーメッセージに '配信枠が存在しません' 含む", msg.includes("配信枠が存在しません"), msg);
  }
  check("例外がスローされた", errorCaught);

  // 4. createSlotsForDate の重複防止確認
  console.log("\n[4] createSlotsForDate — 重複防止");
  await cleanup();
  const cr1 = await createSlotsForDate(TEST_DATE);
  check("初回作成 status=CREATED", cr1.status === "CREATED", `${cr1.createdCount}枠`);
  const cr2 = await createSlotsForDate(TEST_DATE);
  check("再実行 status=SKIPPED", cr2.status === "SKIPPED");
  check("再実行 createdCount=0", cr2.createdCount === 0);

  // クリーンアップ
  await cleanup();
  // テスト用 import ログ削除
  const testLogs = await prisma.scoutImportLog.findMany({
    where: { importType: { in: ["AGGREGATED_JSON", "MANUAL"] }, targetDate: date },
  });
  if (testLogs.length > 0) {
    await prisma.scoutImportLog.deleteMany({
      where: { id: { in: testLogs.map((l) => l.id) } },
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
