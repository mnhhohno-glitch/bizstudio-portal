/**
 * T-064 Phase A 補強: Base64 エクセル取込 API 疎通確認
 *
 * 実行: npx tsx scripts/test-scout-excel-base64.ts
 *
 * 確認項目:
 *  1. importDailyScoutExcel 共通関数がエクセルバッファから配信数を更新できる
 *  2. 既存 multipart 用のコードパスが破壊されていないことの間接確認
 *  3. Base64 デコード → ArrayBuffer → xlsx パースが通る
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as XLSX from "xlsx";
import "dotenv/config";
import {
  createDailySlots,
  getTomorrowJst,
} from "../src/lib/scout/slot-helpers";
import { importDailyScoutExcel } from "../src/lib/scout/daily-excel-importer";

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
  console.log("\n=== T-064 Base64 エクセル取込 疎通確認 ===\n");

  const tomorrow = getTomorrowJst();
  const dateStr = formatDateStr(tomorrow);

  // 前準備: 翌日枠を作成
  await prisma.scoutDeliverySlot.deleteMany({ where: { deliveryDate: tomorrow } });
  const slotResult = await createDailySlots(tomorrow);
  check("配信枠作成", slotResult.created === 96, `${slotResult.created}枠`);

  // 1. ダミーエクセルをバッファで作成
  console.log("\n[1] ダミーエクセル → ArrayBuffer");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["送信時間", "1号機", "2号機", "3号機", "4号機", "5号機", "6号機"],
    ["8:00", 15, 25, 35, 5, 10, 0],
    ["9:00", 16, 26, 36, 6, 11, 0],
    ["10:00", 17, 27, 37, 7, 12, 0],
    ["11:00", 18, 28, 38, 8, 13, 0],
    ["12:00", 19, 29, 39, 9, 14, 0],
    ["13:00", 20, 30, 40, 10, 15, 0],
    ["14:00", 21, 31, 41, 11, 16, 0],
    ["15:00", 22, 32, 42, 12, 17, 0],
    ["16:00", 23, 33, 43, 13, 18, 0],
    ["17:00", 24, 34, 44, 14, 19, 0],
    ["18:00", 25, 35, 45, 15, 20, 0],
    ["19:00", 26, 36, 46, 16, 21, 0],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "サマリ");
  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  check("xlsx バッファ生成 OK", Buffer.isBuffer(buf) && buf.length > 0, `${buf.length} bytes`);

  // 2. ArrayBuffer 経由で共通関数を呼ぶ（multipart 相当）
  console.log("\n[2] importDailyScoutExcel — ArrayBuffer 直接");
  const arrayBuf = new Uint8Array(buf).buffer;
  const result1 = await importDailyScoutExcel({
    fileBuffer: arrayBuf,
    targetDate: dateStr,
    fileName: "test-direct.xlsx",
    importType: "DAILY_EXCEL",
  });
  check("status=COMPLETED", result1.status === "COMPLETED");
  check("successCount > 0", result1.successCount > 0, `${result1.successCount}件`);
  check("failureCount = 0", result1.failureCount === 0, `${result1.failureCount}件`);

  // 検証: 1号機 8時の deliveryCount が 15 になっている
  const slots = await prisma.scoutDeliverySlot.findMany({
    where: { deliveryDate: tomorrow, isMachine: true },
    include: { machine: true },
  });
  const slot1_8 = slots.find((s) => s.hourSlot === 8 && s.machine?.machineNumber === 1);
  check("1号機 8時の deliveryCount=15", slot1_8?.deliveryCount === 15, `actual=${slot1_8?.deliveryCount}`);

  const slot3_10 = slots.find((s) => s.hourSlot === 10 && s.machine?.machineNumber === 3);
  check("3号機 10時の deliveryCount=37", slot3_10?.deliveryCount === 37, `actual=${slot3_10?.deliveryCount}`);

  // 3. Base64 経由（Power Automate 相当のフロー）
  console.log("\n[3] importDailyScoutExcel — Base64 デコード経由");
  // 値を変えた別のエクセルで上書き
  const wb2 = XLSX.utils.book_new();
  const ws2 = XLSX.utils.aoa_to_sheet([
    ["送信時間", "1号機", "2号機", "3号機", "4号機", "5号機", "6号機"],
    ["8:00", 99, 88, 77, 66, 55, 0],
    ["9:00", 0, 0, 0, 0, 0, 0],
    ["10:00", 0, 0, 0, 0, 0, 0],
    ["11:00", 0, 0, 0, 0, 0, 0],
    ["12:00", 0, 0, 0, 0, 0, 0],
    ["13:00", 0, 0, 0, 0, 0, 0],
    ["14:00", 0, 0, 0, 0, 0, 0],
    ["15:00", 0, 0, 0, 0, 0, 0],
    ["16:00", 0, 0, 0, 0, 0, 0],
    ["17:00", 0, 0, 0, 0, 0, 0],
    ["18:00", 0, 0, 0, 0, 0, 0],
    ["19:00", 0, 0, 0, 0, 0, 0],
  ]);
  XLSX.utils.book_append_sheet(wb2, ws2, "サマリ");
  const buf2: Buffer = XLSX.write(wb2, { type: "buffer", bookType: "xlsx" });

  // Base64 エンコード → デコード → ArrayBuffer（API ルートと同じパス）
  const base64Str = buf2.toString("base64");
  check("Base64 エンコード OK", base64Str.length > 0, `${base64Str.length} chars`);

  const decoded = Buffer.from(base64Str, "base64");
  const decodedArrayBuf = new Uint8Array(decoded).buffer;

  const result2 = await importDailyScoutExcel({
    fileBuffer: decodedArrayBuf,
    targetDate: dateStr,
    fileName: "test-base64.xlsx",
    importType: "DAILY_EXCEL_BASE64",
  });
  check("Base64 経由 status=COMPLETED", result2.status === "COMPLETED");
  check("Base64 経由 successCount > 0", result2.successCount > 0, `${result2.successCount}件`);

  // 検証: 1号機 8時の deliveryCount が 99 に上書きされている
  const slot1_8_after = await prisma.scoutDeliverySlot.findUnique({
    where: { id: slot1_8!.id },
  });
  check("Base64 経由で 1号機 8時 deliveryCount=99", slot1_8_after?.deliveryCount === 99, `actual=${slot1_8_after?.deliveryCount}`);

  // 4. ScoutImportLog 確認
  console.log("\n[4] ScoutImportLog 記録確認");
  const logs = await prisma.scoutImportLog.findMany({
    where: { importType: { in: ["DAILY_EXCEL", "DAILY_EXCEL_BASE64"] } },
    orderBy: { startedAt: "desc" },
    take: 4,
  });
  const directLog = logs.find((l) => l.importType === "DAILY_EXCEL" && l.status === "COMPLETED");
  check("DAILY_EXCEL ログが COMPLETED", !!directLog);
  const base64Log = logs.find((l) => l.importType === "DAILY_EXCEL_BASE64" && l.status === "COMPLETED");
  check("DAILY_EXCEL_BASE64 ログが COMPLETED", !!base64Log);

  // クリーンアップ
  await prisma.scoutDeliverySlot.deleteMany({ where: { deliveryDate: tomorrow } });
  // テスト用 import ログも削除
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
