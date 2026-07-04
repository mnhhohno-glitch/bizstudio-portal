/**
 * T-135 step6 / Task 6-2: 直近日（7/3〜today）の配信数を号機送信結果Excelから補正
 *
 * 背景:
 *   FM 全量入替(Task3)後、FM の 7/3〜7/5 は deliveryCount=0（FM未入力）。これらの日の
 *   RPA1〜4号機の配信数を、将幸さんが import-data に置く「送信結果蓄積ファイル_N号機.xlsx」
 *   （実際の送信ログ）から集計して補正する。restore-scout-delivery-t135.ts（7/1・6/30の
 *   定数投入方式）の畳み込み規約・枠特定ロジックを流用し、Excel からの動的抽出に置換した版。
 *
 * 入力: C:\bizstudio\import-data\06.送信結果蓄積ファイル_{1..4}号機.xlsx
 *   シート"送信結果"。列: 顧客ID / 送信メール種類 / 送信日時(Excelシリアル日時) / 送信結果 /
 *   担当者 / 実行環境(号機) / ... / 判定
 *   送信成功 = 送信結果に「送信しました」を含む行のみ計上。
 *
 * 規約（aggregated-importer/restore と同一）:
 *   - hourSlot 8〜19 のみ。早朝(8時未満・5時台等)の送信は 8時枠へ畳み込む。
 *   - 対象枠: 当該日×号機(machineNumber)×hourSlot の RPA/個別配信 枠。deliveryCount 上書き。
 *   - FM の直近日は 1セル=1行（単一枠）なので findRpaSlot が一意に当たる。
 *
 * 自己検証: 7/3 の 1〜3号機を restore スクリプトの DB確認済み定数(VERIFY_0703)と突合し、
 *   Excel解釈（成功判定・時刻抽出・畳み込み）が正しいことを DB非依存で確認する。
 *
 * 対象範囲: 2026-07-03 〜 today(JST)。号機は 1〜4のみ（提供Excelが4台分）。
 *   5・6号機・bizstudio の同期間はFM=0のまま（別途FM更新まで保留・報告する）。
 *
 * Excel未配置ならスキップして報告。--dry-run（既定）/ --execute。idempotent。
 *
 * 実行:
 *   npx tsx scripts/correct-recent-delivery-fm-t135.ts            # 検証+dry-run
 *   npx tsx scripts/correct-recent-delivery-fm-t135.ts --execute  # 本実行
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as XLSX from "xlsx";
import * as fs from "fs";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const EXECUTE = process.argv.includes("--execute");
const MODE = EXECUTE ? "EXECUTE" : "DRY-RUN";

const DIR = "C:/bizstudio/import-data/";
const KOUKI_FILES: Record<number, string> = {
  1: "06.送信結果蓄積ファイル_1号機.xlsx",
  2: "06.送信結果蓄積ファイル_2号機.xlsx",
  3: "06.送信結果蓄積ファイル_3号機.xlsx",
  4: "06.送信結果蓄積ファイル_4号機.xlsx",
};
const START_DATE = "2026-07-03";

// restore-scout-delivery-t135.ts の DB確認済み VERIFY 値（7/3・1〜3号機・畳み込み前の生 byHour）。
// Excel からの再集計がこれと一致すれば解釈が正しい。
const VERIFY_0703_RAW: Record<number, Record<number, number>> = {
  1: { 5: 55, 8: 23, 9: 49, 10: 50, 11: 47, 12: 56, 13: 50, 14: 36, 15: 41, 16: 6, 17: 39, 18: 53, 19: 59 },
  2: { 5: 0, 8: 23, 9: 45, 10: 44, 11: 44, 12: 44, 13: 33, 14: 38, 15: 5, 16: 50, 17: 37, 18: 48, 19: 55 },
  3: { 5: 0, 8: 0, 9: 43, 10: 50, 11: 43, 12: 54, 13: 54, 14: 60, 15: 56, 16: 42, 17: 40, 18: 51, 19: 53 },
};

function ymdToUtcMidnight(ymd: string): Date {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)!;
  return new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])));
}
function todayJst(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
/** 早朝(8時未満)を8時枠へ畳み込み、hourSlot 8〜19 を返す。 */
function foldToSlots(byHour: Record<number, number>): Record<number, number> {
  const out: Record<number, number> = {};
  for (let h = 8; h <= 19; h++) out[h] = byHour[h] ?? 0;
  for (let h = 0; h < 8; h++) out[8] += byHour[h] ?? 0;
  return out;
}

/** 号機Excelを読み、date(YYYY-MM-DD) -> hour -> 成功件数（生・畳み込み前）を返す。 */
function parseKouki(file: string): Record<string, Record<number, number>> {
  const wb = XLSX.readFile(file);
  const sheet = wb.Sheets["送信結果"] ?? wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  // header: 顧客ID(0) 送信メール種類(1) 送信日時(2) 送信結果(3) 担当者(4) 実行環境(5) ...
  const out: Record<string, Record<number, number>> = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const result = r[3] == null ? "" : String(r[3]);
    if (!result.includes("送信しました")) continue; // 成功のみ
    const serial = r[2];
    if (typeof serial !== "number") continue;
    const dc = XLSX.SSF.parse_date_code(serial);
    if (!dc) continue;
    const ymd = `${dc.y}-${String(dc.m).padStart(2, "0")}-${String(dc.d).padStart(2, "0")}`;
    const hour = dc.H;
    if (!out[ymd]) out[ymd] = {};
    out[ymd][hour] = (out[ymd][hour] || 0) + 1;
  }
  return out;
}

async function main() {
  console.log(`=== T-135 step6 Task6-2: 直近日配信数の号機Excel補正 (mode=${MODE}) ===\n`);

  // Excel 存在確認
  const missing = Object.entries(KOUKI_FILES).filter(([, f]) => !fs.existsSync(DIR + f));
  if (missing.length > 0) {
    console.log("号機Excelが未配置のためスキップ（後日実行可能）:");
    for (const [n, f] of missing) console.log(`  ${n}号機: ${DIR + f} が無い`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  const END_DATE = todayJst();
  console.log(`補正対象期間: ${START_DATE} 〜 ${END_DATE}（号機 1〜4）\n`);

  // machineNumber -> machineId
  const masters = await prisma.scoutMachineMaster.findMany({
    where: { isMachine: true, machineNumber: { in: [1, 2, 3, 4] } },
    select: { id: true, machineNumber: true },
  });
  const machineId = new Map<number, string>();
  for (const n of [1, 2, 3, 4]) {
    const hit = masters.filter((m) => m.machineNumber === n);
    if (hit.length !== 1) throw new Error(`machineNumber=${n} が一意でない（${hit.length}件）`);
    machineId.set(n, hit[0].id);
  }

  // 号機Excelパース
  const parsed: Record<number, Record<string, Record<number, number>>> = {};
  for (const n of [1, 2, 3, 4]) parsed[n] = parseKouki(DIR + KOUKI_FILES[n]);

  // --- 自己検証: 7/3 の 1〜3号機を VERIFY_0703_RAW と突合 ---
  console.log("=== 自己検証（7/3・1〜3号機 生byHour を DB確認済み定数と突合）===");
  let vOk = true;
  for (const n of [1, 2, 3]) {
    const got = parsed[n]["2026-07-03"] ?? {};
    const exp = VERIFY_0703_RAW[n];
    const hours = new Set([...Object.keys(got), ...Object.keys(exp)].map(Number));
    const diffs: string[] = [];
    for (const h of [...hours].sort((a, b) => a - b)) {
      const g = got[h] ?? 0;
      const e = exp[h] ?? 0;
      if (g !== e) diffs.push(`h${h}: Excel=${g} 定数=${e}`);
    }
    if (diffs.length === 0) console.log(`  ${n}号機: ✅ 一致`);
    else { vOk = false; console.log(`  ${n}号機: ⚠ 不一致 → ${diffs.join(" / ")}`); }
  }
  console.log(vOk ? "  → Excel解釈OK\n" : "  → ⚠ 解釈に差異あり。以下続行するが要確認\n");

  // --- 補正計画 ---
  type Upd = { day: string; n: number; hour: number; slotId: string; from: number; to: number; slotCount: number };
  const updates: Upd[] = [];
  const skipped: Upd[] = [];
  const ambiguous: string[] = [];
  const dayTotals: Record<string, number> = {};

  for (let d = new Date(ymdToUtcMidnight(START_DATE)); d <= ymdToUtcMidnight(END_DATE); d.setUTCDate(d.getUTCDate() + 1)) {
    const ymd = d.toISOString().slice(0, 10);
    for (const n of [1, 2, 3, 4]) {
      const byHour = parsed[n][ymd];
      if (!byHour) continue; // その日の送信なし
      const folded = foldToSlots(byHour);
      for (let h = 8; h <= 19; h++) {
        const to = folded[h];
        const slots = await prisma.scoutDeliverySlot.findMany({
          where: { deliveryDate: ymdToUtcMidnight(ymd), machineId: machineId.get(n)!, hourSlot: h, deliveryCategoryLarge: "RPA", deliveryCategoryMedium: "個別配信" },
          select: { id: true, deliveryCount: true },
        });
        if (slots.length !== 1) {
          if (to > 0) ambiguous.push(`${ymd} ${n}号機 ${h}時: RPA/個別配信枠が ${slots.length} 件（to=${to}・スキップ）`);
          continue;
        }
        dayTotals[ymd] = (dayTotals[ymd] || 0) + to;
        const rec: Upd = { day: ymd, n, hour: h, slotId: slots[0].id, from: slots[0].deliveryCount, to, slotCount: 1 };
        if (slots[0].deliveryCount === to) skipped.push(rec);
        else updates.push(rec);
      }
    }
  }

  console.log("=== 補正計画 ===");
  console.log(`更新: ${updates.length} / スキップ(一致): ${skipped.length} / 枠特定不能: ${ambiguous.length}`);
  console.log("日別合計(号機1〜4・畳み込み後):");
  for (const day of Object.keys(dayTotals).sort()) console.log(`  ${day}: ${dayTotals[day]}`);
  if (ambiguous.length > 0) {
    console.log("[枠特定不能]");
    ambiguous.slice(0, 40).forEach((s) => console.log("  " + s));
  }

  if (!EXECUTE) {
    console.log(`\n(DRY-RUN: 未実行。--execute で ${updates.length} 件上書き)`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  // --- EXECUTE ---
  console.log(`\n=== EXECUTE ===`);
  let ok = 0;
  const perDay: Record<string, number> = {};
  for (const u of updates) {
    await prisma.scoutDeliverySlot.update({ where: { id: u.slotId }, data: { deliveryCount: u.to } });
    ok++;
    perDay[u.day] = (perDay[u.day] || 0) + 1;
  }
  for (const day of Object.keys(perDay)) {
    await prisma.scoutImportLog.create({
      data: {
        importType: "MANUAL",
        fileName: `T-135 correct-recent-delivery ${day} (号機1-4)`,
        targetDate: ymdToUtcMidnight(day),
        totalRows: perDay[day],
        successCount: perDay[day],
        failureCount: 0,
        status: "COMPLETED",
        finishedAt: new Date(),
      },
    });
  }
  console.log(`更新=${ok} 件 / ScoutImportLog=${Object.keys(perDay).length} 件`);
  console.log(`\n[申し送り] 5・6号機・bizstudio の ${START_DATE}〜${END_DATE} は FM=0 のまま（提供Excelが1〜4号機のみ）。`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(1);
});
