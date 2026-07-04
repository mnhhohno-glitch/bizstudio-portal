/**
 * T-135 step6 / Task 5: 答え合わせ（execute 後の検証・書き込みなし）
 *
 * 1) 枠ごとの linkedCandidates 数 と FM 応募数列 を突合。日別合計の一致率＋上位20差分。
 * 2) 配信日別（dateMode=sent 相当）で 6/30・7/1 の配信数合計を実測（画面期待値 1,777 / 1,867）。
 * 3) 応募総数の不変性: dateMode=sent と dateMode=applied の総応募数が一致すること
 *    （同一 linkedCandidates 集合を配信日/応募日どちらで束ねるかの違いのみ・総数は不変）。
 *
 * 実行: npx tsx scripts/verify-fm-links-t135.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as XLSX from "xlsx";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const FM_PATH = "C:/bizstudio/import-data/スカウトデータ過去すべて.xlsx";

function excelDateToYMD(v: unknown): string | null {
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : null;
  }
  return null;
}
function parseHour(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Math.floor((v - Math.floor(v)) * 24 + 1e-6);
  const m = String(v).trim().match(/^(\d{1,2})[:：]/);
  return m ? parseInt(m[1], 10) : null;
}
function jstYmd(d: Date): string {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, "0")}-${String(j.getUTCDate()).padStart(2, "0")}`;
}

async function main() {
  console.log(`=== T-135 step6 Task5: 答え合わせ ===\n`);

  // FM: scoutNumber -> {apply, ymd}（取込対象=hour<20 かつ hour!=null）
  const wb = XLSX.readFile(FM_PATH);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true }).slice(1);
  const fmApplyBySc = new Map<string, number>();
  const fmApplyByDay: Record<string, number> = {};
  let fmApplyTotal = 0;
  for (const r of rows) {
    const hour = parseHour(r[2]);
    if (hour == null || hour >= 20) continue;
    const sc = String(r[0]).trim();
    const ymd = excelDateToYMD(r[1]);
    const apply = Number(r[12]) || 0;
    fmApplyBySc.set(sc, apply);
    fmApplyTotal += apply;
    if (ymd) fmApplyByDay[ymd] = (fmApplyByDay[ymd] || 0) + apply;
  }
  console.log(`FM 応募数合計(取込対象): ${fmApplyTotal}`);

  // DB: slot -> {scoutNumber, deliveryDate, deliveryCount, linkedCount}
  const slots = await prisma.scoutDeliverySlot.findMany({
    select: { id: true, scoutNumber: true, deliveryDate: true, deliveryCount: true },
  });
  // linkedCandidates count per slot
  const grouped = await prisma.candidate.groupBy({
    by: ["scoutDeliverySlotId"],
    where: { scoutDeliverySlotId: { not: null } },
    _count: { _all: true },
  });
  const linkBySlot = new Map<string, number>();
  let linkedTotal = 0;
  for (const g of grouped) {
    if (g.scoutDeliverySlotId) { linkBySlot.set(g.scoutDeliverySlotId, g._count._all); linkedTotal += g._count._all; }
  }
  console.log(`DB 紐付き Candidate 総数: ${linkedTotal}\n`);

  // 日別: FM応募 vs DB紐付け（deliveryDate基準）
  const dbLinkByDay: Record<string, number> = {};
  const dbDeliveryByDay: Record<string, number> = {};
  const perSlotDiffs: Array<{ sc: string; ymd: string; fm: number; db: number }> = [];
  for (const s of slots) {
    const ymd = s.deliveryDate.toISOString().slice(0, 10);
    const db = linkBySlot.get(s.id) ?? 0;
    const fm = fmApplyBySc.get(s.scoutNumber) ?? 0;
    dbLinkByDay[ymd] = (dbLinkByDay[ymd] || 0) + db;
    dbDeliveryByDay[ymd] = (dbDeliveryByDay[ymd] || 0) + s.deliveryCount;
    if (db !== fm) perSlotDiffs.push({ sc: s.scoutNumber, ymd, fm, db });
  }

  // 1) 日別突合サマリ
  const allDays = Array.from(new Set([...Object.keys(fmApplyByDay), ...Object.keys(dbLinkByDay)])).sort();
  let dayMatch = 0, dayDiff = 0;
  const dayDiffs: Array<{ day: string; fm: number; db: number }> = [];
  for (const d of allDays) {
    const fm = fmApplyByDay[d] || 0;
    const db = dbLinkByDay[d] || 0;
    if (fm === db) dayMatch++;
    else { dayDiff++; dayDiffs.push({ day: d, fm, db }); }
  }
  console.log(`=== 1) 日別 FM応募 vs DB紐付け(配信日基準) ===`);
  console.log(`一致日数: ${dayMatch} / 不一致日数: ${dayDiff}`);
  console.log(`per-slot 差分件数: ${perSlotDiffs.length}（FM応募は配信バッチ単位・DB紐付けは実在Candidate単位のため差は自然）`);
  console.log(`日別差分 上位20:`);
  dayDiffs.sort((a, b) => Math.abs(b.fm - b.db) - Math.abs(a.fm - a.db)).slice(0, 20)
    .forEach((x) => console.log(`  ${x.day}: FM応募=${x.fm} / DB紐付け=${x.db} (差${x.db - x.fm})`));
  console.log(`\nper-slot 差分 上位20:`);
  perSlotDiffs.sort((a, b) => Math.abs(b.db - b.fm) - Math.abs(a.db - a.fm)).slice(0, 20)
    .forEach((x) => console.log(`  ${x.sc} ${x.ymd}: FM=${x.fm} DB=${x.db}`));

  // 2) 配信日別 配信数（画面期待値）
  console.log(`\n=== 2) 配信日別 配信数合計（画面 dateMode=sent 相当）===`);
  console.log(`  2026-06-30 = ${dbDeliveryByDay["2026-06-30"] ?? 0}（期待 1,777）`);
  console.log(`  2026-07-01 = ${dbDeliveryByDay["2026-07-01"] ?? 0}（期待 1,867）`);
  console.log(`  2026-07-02 = ${dbDeliveryByDay["2026-07-02"] ?? 0}`);

  // 3) 応募総数の不変性（sent集計 total == applied集計 total）
  //    sent: deliveryDate で束ねる / applied: applicationDate(なければcreatedAt JST)で束ねる。総数は同一集合なので不変。
  const linkedCands = await prisma.candidate.findMany({
    where: { scoutDeliverySlotId: { not: null } },
    select: { applicationDate: true, createdAt: true },
  });
  const appliedByDay: Record<string, number> = {};
  for (const c of linkedCands) {
    const d = c.applicationDate ?? c.createdAt;
    const ymd = c.applicationDate ? c.applicationDate.toISOString().slice(0, 10) : jstYmd(c.createdAt);
    appliedByDay[ymd] = (appliedByDay[ymd] || 0) + 1;
  }
  const sentTotal = Object.values(dbLinkByDay).reduce((a, b) => a + b, 0);
  const appliedTotal = Object.values(appliedByDay).reduce((a, b) => a + b, 0);
  console.log(`\n=== 3) 応募総数の不変性（同一集合の束ね替え）===`);
  console.log(`  配信日別(sent)集計 総応募数: ${sentTotal}`);
  console.log(`  応募日別(applied)集計 総応募数: ${appliedTotal}`);
  console.log(`  → ${sentTotal === appliedTotal ? "✅ 一致（束ね替えのみ・総数不変）" : "⚠ 不一致"}`);

  await prisma.$disconnect();
  await pool.end();
}
main().catch(async (e) => { console.error(e); try { await prisma.$disconnect(); } catch {} try { await pool.end(); } catch {} process.exit(1); });
