/**
 * T-135 step6 / Task 3: 配信枠の全消し → ファイルメーカー(FM)全量投入
 *
 * FM が SSoT。ScoutDeliverySlot を全件 DELETE（Candidate.scoutDeliverySlotId は FK=SET NULL で
 * 自動解除）し、FM Excel の全量データで入れ替える。応募は求職者紐付け（Task4）から数えるため、
 * FM の応募数列は枠に保存しない（Task5 の答え合わせ専用）。
 *
 * 入力: C:\bizstudio\import-data\スカウトデータ過去すべて.xlsx
 *   列: スカウトNO / 配信日 / 配信時間 / 時間帯フラグ / 配信数 / 開封数 / 媒体 / 配信種別 /
 *       配信手法 / 社員NO / 社員_氏 / 社員_名 / 応募数
 *
 * 除外（取込対象外）:
 *   - 配信時間の時が 20 以上（16行・全2024前半・日経HR/個別配信）
 *   - 配信時間が欠損かつ時間帯フラグも欠損で補完不能（2行: SC10001281, SC10016263）
 *   → 取込対象 56,816行（56,834 − 16 − 2）
 *
 * 値マッピング（確定・推測禁止）:
 *   - deliveryCategoryLarge: RPAスカウト→"RPA" / 支援スカウト・自己スカウト→"社員"
 *   - deliveryCategoryMedium: 配信手法そのまま（個別配信/一斉配信）
 *   - deliveryCategorySmall: null（FM該当なし）
 *   - hourSlot: 配信時間の「時」（8〜19）
 *   - machineId: 社員NO(BS#)→recruiterName→ScoutMachineMaster.id（下表・Task2追加後に一意解決）
 *   - isMachine/isStaff: 解決した master.isMachine に従う
 *   - isAggregationTarget: 全行 true（社員・一斉配信も集計対象にするのが本改修の目的）
 *   - deliveryCount / openCount: FM値（null→0）
 *   - mediaSource: FM媒体。空欄は "" で格納（列が非nullableのため null 不可）
 *   - scoutNumber: FM スカウトNO（SC+8桁・全行ユニーク）
 *
 * ScoutSequence: lastNumber ≥ FM最大(10,066,120) を検証のみ（更新しない）。
 *
 * 冪等性: execute は「全消し→全投入」なので再実行すれば同じ最終状態になる（ただし毎回 DELETE する）。
 * --dry-run（既定）/ --execute。execute 時は削除前にロールバックCSVを verify/ に保存。
 *
 * 実行:
 *   npx tsx scripts/replace-slots-from-fm-t135.ts            # DRY-RUN
 *   npx tsx scripts/replace-slots-from-fm-t135.ts --execute  # 本実行（共有prod DB）
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const EXECUTE = process.argv.includes("--execute");
const MODE = EXECUTE ? "EXECUTE" : "DRY-RUN";

const FM_PATH = "C:/bizstudio/import-data/スカウトデータ過去すべて.xlsx";
const FM_MAX_SCOUT = 10066120; // プロファイル実測（Task0）

// 社員NO → recruiterName（Task2 追加後、recruiterName は全行一意に解決可能）
const EMPLOYEE_TO_NAME: Record<string, string> = {
  BS1000001: "大野 将幸",
  BS1000002: "小野 有加",
  BS1000003: "藤本 夏海",
  BS1000004: "大野 望",
  BS1000005: "上原 千遥（本人）",
  BS1000007: "岡田 愛子（本人）",
  BS1000010: "藤本 なつみ",
  BS1000011: "岡田 かなこ",
  BS1000012: "上原 ちはる",
  BS1000013: "上原 千遥",
  BS1000014: "岡田 愛子",
  BS1000015: "安藤 嘉富",
  BS1000016: "岡田 愛子(bizstudio)",
};

// ---------- helpers ----------
function excelDateToYMD(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}
function parseHour(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Math.floor((v - Math.floor(v)) * 24 + 1e-6);
  const m = String(v).trim().match(/^(\d{1,2})[:：]/);
  if (m) return parseInt(m[1], 10);
  const m2 = String(v).trim().match(/^(\d{1,2})$/);
  if (m2) return parseInt(m2[1], 10);
  return null;
}
function ymdToUtcMidnight(ymd: string): Date {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)!;
  return new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])));
}
function catLarge(fmType: string): string {
  if (fmType === "RPAスカウト") return "RPA";
  if (fmType === "支援スカウト" || fmType === "自己スカウト") return "社員";
  return "社員"; // フォールバック（想定外の種別）
}
function ts(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}
function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type SlotRow = {
  scoutNumber: string;
  deliveryDate: Date;
  hourSlot: number;
  machineId: string;
  isMachine: boolean;
  isStaff: boolean;
  deliveryCategoryLarge: string;
  deliveryCategoryMedium: string | null;
  deliveryCategorySmall: string | null;
  mediaSource: string;
  searchConditionName: string | null;
  deliveryCount: number;
  openCount: number;
  isAggregationTarget: boolean;
};

async function main() {
  console.log(`=== T-135 step6 Task3: 全消し→FM投入 (mode=${MODE}) ===\n`);

  // ---- master 解決 ----
  const masters = await prisma.scoutMachineMaster.findMany({
    select: { id: true, recruiterName: true, isMachine: true, machineNumber: true },
  });
  const nameToMasters = new Map<string, typeof masters>();
  for (const m of masters) {
    const arr = nameToMasters.get(m.recruiterName) ?? [];
    arr.push(m);
    nameToMasters.set(m.recruiterName, arr);
  }
  const empToMaster: Record<string, { id: string; isMachine: boolean }> = {};
  const resolveErrors: string[] = [];
  for (const [emp, name] of Object.entries(EMPLOYEE_TO_NAME)) {
    const hit = nameToMasters.get(name);
    if (!hit || hit.length === 0) {
      resolveErrors.push(`${emp} → recruiterName="${name}" のマスタが見つからない（Task2 未実行?）`);
    } else if (hit.length > 1) {
      resolveErrors.push(`${emp} → recruiterName="${name}" のマスタが${hit.length}件（一意でない）`);
    } else {
      empToMaster[emp] = { id: hit[0].id, isMachine: hit[0].isMachine };
    }
  }
  if (resolveErrors.length > 0) {
    console.error("社員NO→master 解決に失敗:");
    for (const e of resolveErrors) console.error("  ✗ " + e);
    console.error("\n中止: Task2(add-scout-masters-t135.ts --execute) を先に実行してください。");
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  }
  console.log("社員NO→master 解決 OK（13社員NO 全て一意解決）\n");

  // ---- Excel パース ----
  const wb = XLSX.readFile(FM_PATH);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true }).slice(1);
  const I = { sc: 0, date: 1, time: 2, flag: 3, dcount: 4, ocount: 5, media: 6, cat: 7, method: 8, emp: 9, apply: 12 };

  const slotRows: SlotRow[] = [];
  const excludedOver20: Array<Record<string, unknown>> = [];
  const excludedNoTime: Array<Record<string, unknown>> = [];
  const unknownEmp: Array<Record<string, unknown>> = [];
  const badDate: Array<Record<string, unknown>> = [];

  let dcountSum = 0;
  let applySumAll = 0;
  const empRowCount: Record<string, number> = {};
  const dayDcount: Record<string, number> = {};
  const scSeen = new Set<string>();
  let scDup = 0;
  const mediaDist: Record<string, number> = {};
  const catDist: Record<string, number> = {};

  for (const r of rows) {
    const sc = r[I.sc] == null ? "" : String(r[I.sc]).trim();
    const ymd = excelDateToYMD(r[I.date]);
    const hour = parseHour(r[I.time]);
    const dcount = Number(r[I.dcount]) || 0;
    const ocount = Number(r[I.ocount]) || 0;
    const apply = Number(r[I.apply]) || 0;
    const emp = r[I.emp] == null ? "" : String(r[I.emp]).trim();
    const fmType = r[I.cat] == null ? "" : String(r[I.cat]).trim();
    const method = r[I.method] == null || String(r[I.method]).trim() === "" ? null : String(r[I.method]).trim();
    const mediaRaw = r[I.media] == null ? "" : String(r[I.media]).trim();

    applySumAll += apply;

    // 除外1: 20時以降
    if (hour != null && hour >= 20) {
      excludedOver20.push({ sc, date: ymd, hour, dcount, apply });
      continue;
    }
    // 除外2: 配信時間欠損（フラグからの補完不可 → 除外）
    if (hour == null) {
      excludedNoTime.push({ sc, date: ymd, flag: r[I.flag], dcount, emp });
      continue;
    }
    // 日付不正
    if (!ymd) {
      badDate.push({ sc, dateRaw: r[I.date], emp });
      continue;
    }
    // 社員NO 解決
    const master = empToMaster[emp];
    if (!master) {
      unknownEmp.push({ sc, date: ymd, emp });
      continue;
    }

    if (scSeen.has(sc)) scDup++; else scSeen.add(sc);

    const large = catLarge(fmType);
    slotRows.push({
      scoutNumber: sc,
      deliveryDate: ymdToUtcMidnight(ymd),
      hourSlot: hour,
      machineId: master.id,
      isMachine: master.isMachine,
      isStaff: !master.isMachine,
      deliveryCategoryLarge: large,
      deliveryCategoryMedium: method,
      deliveryCategorySmall: null,
      mediaSource: mediaRaw, // 空欄は "" で格納（非nullable列）
      searchConditionName: null,
      deliveryCount: dcount,
      openCount: ocount,
      isAggregationTarget: true,
    });

    dcountSum += dcount;
    empRowCount[emp] = (empRowCount[emp] || 0) + 1;
    dayDcount[ymd] = (dayDcount[ymd] || 0) + dcount;
    const mediaKey = mediaRaw === "" ? "(空欄→\"\")" : mediaRaw;
    mediaDist[mediaKey] = (mediaDist[mediaKey] || 0) + 1;
    catDist[large] = (catDist[large] || 0) + 1;
  }

  // ---- dry-run 照合出力 ----
  console.log("=== 取込サマリ ===");
  console.log(`取込予定行数: ${slotRows.length}（期待 56,816 = 56,834 − 20時以降16 − 時間欠損2）`);
  console.log(`除外(20時以降): ${excludedOver20.length}`);
  console.log(`除外(配信時間欠損・補完不可): ${excludedNoTime.length}`);
  console.log(`  詳細: ${JSON.stringify(excludedNoTime)}`);
  console.log(`日付不正: ${badDate.length}${badDate.length ? " " + JSON.stringify(badDate) : ""}`);
  console.log(`社員NO未解決: ${unknownEmp.length}${unknownEmp.length ? " " + JSON.stringify(unknownEmp.slice(0, 20)) : ""}`);
  console.log(`scoutNumber重複: ${scDup}`);
  console.log("");
  console.log(`配信数合計(取込分): ${dcountSum}（参考: 全量-20時以降=1,139,820。時間欠損2行分を引いた値になる）`);
  console.log(`応募数合計(FM全行・参考): ${applySumAll}（期待 4,326・枠には保存しない）`);
  console.log("");
  console.log("=== 20時以降 除外16行 明細 ===");
  console.log(JSON.stringify(excludedOver20));
  console.log("");
  console.log("=== 社員NO別 取込行数 ===");
  for (const emp of Object.keys(EMPLOYEE_TO_NAME)) {
    console.log(`  ${emp} ${EMPLOYEE_TO_NAME[emp]}: ${empRowCount[emp] || 0}`);
  }
  console.log("");
  console.log("=== 媒体分布(取込分) ===");
  console.log(JSON.stringify(mediaDist));
  console.log("=== 種別large分布(取込分) ===");
  console.log(JSON.stringify(catDist));
  console.log("");
  console.log("=== 日別サンプル ===");
  for (const d of ["2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03"]) {
    console.log(`  ${d}: 配信数=${dayDcount[d] ?? 0}`);
  }
  console.log("");

  // ScoutSequence 検証
  const seq = await prisma.scoutSequence.findFirst();
  console.log(`ScoutSequence.lastNumber=${seq?.lastNumber} / FM最大=${FM_MAX_SCOUT} → ${(seq?.lastNumber ?? 0) >= FM_MAX_SCOUT ? "OK（採番衝突なし・更新不要）" : "⚠ 衝突リスク"}`);

  const curSlotCount = await prisma.scoutDeliverySlot.count();
  const curLinked = await prisma.candidate.count({ where: { scoutDeliverySlotId: { not: null } } });
  console.log(`\n現行 ScoutDeliverySlot: ${curSlotCount}件 / 紐付き Candidate: ${curLinked}件（execute で全削除→SET NULL）`);

  if (!EXECUTE) {
    console.log(`\n(DRY-RUN: 未実行。--execute で本実行)`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  // ================= EXECUTE =================
  console.log(`\n=== EXECUTE ===`);

  // 1) ロールバックCSV（削除前・必須）
  const verifyDir = path.join(process.cwd(), "verify");
  if (!fs.existsSync(verifyDir)) fs.mkdirSync(verifyDir, { recursive: true });
  const stamp = ts();

  const allSlots = await prisma.scoutDeliverySlot.findMany();
  const slotsCsv = [
    ["id", "scoutNumber", "deliveryDate", "hourSlot", "machineId", "isMachine", "isStaff",
     "deliveryCategoryLarge", "deliveryCategoryMedium", "deliveryCategorySmall", "mediaSource",
     "searchConditionName", "deliveryCount", "openCount", "isAggregationTarget", "memo",
     "createdById", "updatedById", "createdAt", "updatedAt"].join(","),
    ...allSlots.map((s) => [
      s.id, s.scoutNumber, s.deliveryDate.toISOString().slice(0, 10), s.hourSlot, s.machineId, s.isMachine, s.isStaff,
      s.deliveryCategoryLarge, s.deliveryCategoryMedium, s.deliveryCategorySmall, s.mediaSource,
      s.searchConditionName, s.deliveryCount, s.openCount, s.isAggregationTarget, s.memo,
      s.createdById, s.updatedById, s.createdAt.toISOString(), s.updatedAt.toISOString(),
    ].map(csvEscape).join(",")),
  ].join("\n");
  const slotsRbPath = path.join(verifyDir, `t135-slots-rollback-${stamp}.csv`);
  fs.writeFileSync(slotsRbPath, slotsCsv, "utf8");

  const linkedCands = await prisma.candidate.findMany({
    where: { scoutDeliverySlotId: { not: null } },
    select: {
      id: true, candidateNumber: true, scoutNumber: true, scoutDeliveryDate: true,
      scoutDeliverySlot: { select: { scoutNumber: true, deliveryDate: true } },
    },
  });
  const linksCsv = [
    ["candidateId", "candidateNumber", "candidateScoutNumber", "candidateScoutDeliveryDate", "slotScoutNumber", "slotDeliveryDate"].join(","),
    ...linkedCands.map((c) => [
      c.id, c.candidateNumber, c.scoutNumber, c.scoutDeliveryDate?.toISOString().slice(0, 10) ?? "",
      c.scoutDeliverySlot?.scoutNumber ?? "", c.scoutDeliverySlot?.deliveryDate?.toISOString().slice(0, 10) ?? "",
    ].map(csvEscape).join(",")),
  ].join("\n");
  const linksRbPath = path.join(verifyDir, `t135-links-rollback-${stamp}.csv`);
  fs.writeFileSync(linksRbPath, linksCsv, "utf8");

  console.log(`ロールバックCSV: ${slotsRbPath} (${allSlots.length}行)`);
  console.log(`ロールバックCSV: ${linksRbPath} (${linkedCands.length}行)`);

  // 2) 全削除（Candidate.scoutDeliverySlotId は FK=SET NULL で自動解除）
  const del = await prisma.scoutDeliverySlot.deleteMany({});
  console.log(`削除: ${del.count}件`);

  // 3) FM 投入（1000行チャンク）
  const CHUNK = 1000;
  let inserted = 0;
  for (let i = 0; i < slotRows.length; i += CHUNK) {
    const chunk = slotRows.slice(i, i + CHUNK);
    const res = await prisma.scoutDeliverySlot.createMany({ data: chunk });
    inserted += res.count;
    if ((i / CHUNK) % 10 === 0 || i + CHUNK >= slotRows.length) {
      console.log(`  投入 ${inserted}/${slotRows.length}`);
    }
  }
  console.log(`投入完了: ${inserted}件`);

  // 4) ScoutSequence 再検証（更新しない）
  const seq2 = await prisma.scoutSequence.findFirst();
  console.log(`ScoutSequence.lastNumber=${seq2?.lastNumber}（FM最大=${FM_MAX_SCOUT}・更新なし）`);

  // 5) ScoutImportLog 記録
  const importLog = await prisma.scoutImportLog.create({
    data: {
      importType: "FILEMAKER_LEGACY",
      fileName: "スカウトデータ過去すべて.xlsx (T-135 full replace)",
      totalRows: rows.length,
      successCount: inserted,
      failureCount: excludedOver20.length + excludedNoTime.length + badDate.length + unknownEmp.length,
      status: "COMPLETED",
      finishedAt: new Date(),
    },
    select: { id: true },
  });
  console.log(`ScoutImportLog: ${importLog.id}`);

  // 6) 最終検証
  const finalCount = await prisma.scoutDeliverySlot.count();
  const finalSum = await prisma.scoutDeliverySlot.aggregate({ _sum: { deliveryCount: true } });
  console.log(`\n[検証] 最終 ScoutDeliverySlot件数: ${finalCount}（期待 ${slotRows.length}）`);
  console.log(`[検証] deliveryCount合計: ${finalSum._sum.deliveryCount}（dry-run値 ${dcountSum} と一致すべき）`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(1);
});
