/**
 * T-135 step6 / Task 4: 求職者スカウトNO投入 ＋ 配信枠への再紐付け
 *
 * FM全量投入(Task3)後、対応表（スカウトNO.xlsx: 求職者NO↔スカウトNO）で
 *   1) Candidate.scoutNumber を対応表の値で上書き（現在の値は auto-link が書いた枠番号で
 *      対応表と一致しないため無価値。対応表を正とする）
 *   2) scoutNumber で新スロット(FM由来)を引き、scoutDeliverySlotId と scoutDeliveryDate を設定
 *      （scoutDeliveryDate は枠の deliveryDate。T-A の配信日起算集計がこのカラムも参照するため整合）
 *
 * 入力: C:\bizstudio\import-data\スカウトNO.xlsx（求職者NO / スカウトNO）
 *
 * 枠存在判定:
 *   - execute: DB の実スロット(Task3投入済)を scoutNumber で解決（FK に必要な slot.id を取得）
 *   - dry-run: Task3 未実行のため、FM Excel の取込対象SC集合で「Task3後に紐付く見込み」を予測
 *
 * 対象外の報告: SC空欄 / Candidate不在 / FMにSC不在（枠が作られない）。各件数＋明細CSV。
 *
 * 冪等: 再実行で同じ最終状態。--dry-run（既定）/ --execute。
 *
 * 実行:
 *   npx tsx scripts/relink-candidates-fm-t135.ts            # DRY-RUN
 *   npx tsx scripts/relink-candidates-fm-t135.ts --execute  # 本実行（Task3 execute 後）
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

const MAP_PATH = "C:/bizstudio/import-data/スカウトNO.xlsx";
const FM_PATH = "C:/bizstudio/import-data/スカウトデータ過去すべて.xlsx";

function excelDateToYMD(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : null;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
}
function parseHour(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Math.floor((v - Math.floor(v)) * 24 + 1e-6);
  const m = String(v).trim().match(/^(\d{1,2})[:：]/);
  return m ? parseInt(m[1], 10) : null;
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

async function main() {
  console.log(`=== T-135 step6 Task4: 求職者スカウトNO投入＋再紐付け (mode=${MODE}) ===\n`);

  // FM Excel の取込対象SC集合（Task3 と同じフィルタ: hour>=20 と hour==null を除外）
  const fmWb = XLSX.readFile(FM_PATH);
  const fmRows = XLSX.utils.sheet_to_json<unknown[]>(fmWb.Sheets[fmWb.SheetNames[0]], { header: 1, defval: null, raw: true }).slice(1);
  const fmIncludedSc = new Set<string>();
  for (const r of fmRows) {
    const hour = parseHour(r[2]);
    if (hour == null || hour >= 20) continue;
    fmIncludedSc.add(String(r[0]).trim());
  }
  console.log(`FM 取込対象SC集合: ${fmIncludedSc.size}件`);

  // 対応表
  const mapWb = XLSX.readFile(MAP_PATH);
  const mapRows = XLSX.utils.sheet_to_json<unknown[]>(mapWb.Sheets[mapWb.SheetNames[0]], { header: 1, defval: null, raw: true }).slice(1);
  console.log(`対応表: ${mapRows.length}行\n`);

  // DB: candidateNumber → id, 現 scoutNumber
  const candidates = await prisma.candidate.findMany({
    select: { id: true, candidateNumber: true, scoutNumber: true, scoutDeliverySlotId: true },
  });
  const candByNumber = new Map(candidates.map((c) => [c.candidateNumber, c]));

  // DB: 実スロット scoutNumber → {id, deliveryDate}（execute 時に authoritative）
  const dbSlots = await prisma.scoutDeliverySlot.findMany({ select: { id: true, scoutNumber: true, deliveryDate: true } });
  const dbScToSlot = new Map(dbSlots.map((s) => [s.scoutNumber, s]));
  console.log(`DB スロット: ${dbSlots.length}件（scoutNumberで解決）\n`);

  type Plan = {
    candidateNumber: string;
    sc: string;
    candidateId: string;
    slotId: string | null;
    deliveryDate: Date | null;
    predicted: boolean; // dry-run: FM集合にあり Task3後に紐付く見込み
  };
  const plans: Plan[] = [];
  const scBlank: string[] = [];
  const candMissing: Array<{ candidateNumber: string; sc: string }> = [];
  const scNotInFm: Array<{ candidateNumber: string; sc: string }> = [];

  for (const r of mapRows) {
    const candNo = r[0] == null ? "" : String(r[0]).trim();
    const sc = r[1] == null ? "" : String(r[1]).trim();
    if (!sc) { scBlank.push(candNo); continue; }
    const cand = candByNumber.get(candNo);
    if (!cand) { candMissing.push({ candidateNumber: candNo, sc }); continue; }

    const dbSlot = dbScToSlot.get(sc);
    const inFm = fmIncludedSc.has(sc);
    if (!dbSlot && !inFm) {
      // FM に存在しない SC（枠が作られない）
      scNotInFm.push({ candidateNumber: candNo, sc });
      // scoutNumber は上書きするが枠紐付けはしない
      plans.push({ candidateNumber: candNo, sc, candidateId: cand.id, slotId: null, deliveryDate: null, predicted: false });
      continue;
    }
    plans.push({
      candidateNumber: candNo,
      sc,
      candidateId: cand.id,
      slotId: dbSlot?.id ?? null,
      deliveryDate: dbSlot?.deliveryDate ?? null,
      predicted: !dbSlot && inFm,
    });
  }

  const willLink = plans.filter((p) => p.slotId != null || p.predicted).length;
  const scOverwriteOnly = plans.filter((p) => p.slotId == null && !p.predicted).length;

  console.log("=== サマリ ===");
  console.log(`対応表 SC有: ${mapRows.length - scBlank.length} / SC空欄: ${scBlank.length}`);
  console.log(`Candidate不在(スキップ): ${candMissing.length}`);
  console.log(`scoutNumber上書き対象(Candidate実在): ${plans.length}`);
  console.log(`  └ うち枠紐付け${EXECUTE ? "" : "見込み"}: ${willLink}（期待 概算3,600〜3,700）`);
  console.log(`  └ うちscoutNumberのみ更新(FMにSC不在・枠なし): ${scOverwriteOnly}`);
  console.log("");
  console.log("=== 移動サンプル10件（candidateNumber / SC / 配信日） ===");
  for (const p of plans.filter((p) => p.slotId != null || p.predicted).slice(0, 10)) {
    console.log(`  ${p.candidateNumber} / ${p.sc} / ${p.deliveryDate ? p.deliveryDate.toISOString().slice(0, 10) : "(Task3後に確定)"}`);
  }
  console.log("");

  // 対象外CSV（dry-run/execute 共通で出力）
  const verifyDir = path.join(process.cwd(), "verify");
  if (!fs.existsSync(verifyDir)) fs.mkdirSync(verifyDir, { recursive: true });
  const stamp = ts();
  fs.writeFileSync(
    path.join(verifyDir, `t135-relink-skipped-${MODE.toLowerCase()}-${stamp}.csv`),
    ["type,candidateNumber,scoutNumber",
      ...scBlank.map((n) => `SC空欄,${csvEscape(n)},`),
      ...candMissing.map((x) => `Candidate不在,${csvEscape(x.candidateNumber)},${csvEscape(x.sc)}`),
      ...scNotInFm.map((x) => `FMにSC不在,${csvEscape(x.candidateNumber)},${csvEscape(x.sc)}`),
    ].join("\n"),
    "utf8",
  );
  console.log(`対象外CSV: verify/t135-relink-skipped-${MODE.toLowerCase()}-${stamp}.csv`);
  console.log(`  SC空欄=${scBlank.length} / Candidate不在=${candMissing.length} / FMにSC不在=${scNotInFm.length}`);

  if (!EXECUTE) {
    console.log(`\n(DRY-RUN: 未実行。Task3 execute 後に --execute で本実行)`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  // ================= EXECUTE =================
  console.log(`\n=== EXECUTE ===`);
  let scUpdated = 0, linked = 0, err = 0, notInDb = 0;
  const now = new Date();
  for (const p of plans) {
    try {
      const slot = dbScToSlot.get(p.sc);
      if (p.slotId == null && !slot) {
        // 枠なし: scoutNumber のみ上書き
        await prisma.candidate.update({ where: { id: p.candidateId }, data: { scoutNumber: p.sc } });
        scUpdated++;
        continue;
      }
      if (!slot) { notInDb++; continue; } // 想定外（predictだが実DBに無い）
      await prisma.candidate.update({
        where: { id: p.candidateId },
        data: {
          scoutNumber: p.sc,
          scoutDeliverySlotId: slot.id,
          scoutDeliveryDate: slot.deliveryDate,
          scoutLinkedAt: now,
        },
      });
      scUpdated++;
      linked++;
    } catch (e) {
      err++;
      if (err <= 10) console.error(`  ✗ ${p.candidateNumber} (${p.sc}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`scoutNumber更新=${scUpdated} / 枠紐付け=${linked} / DB枠なし(想定外)=${notInDb} / エラー=${err}`);

  // 検証
  const finalLinked = await prisma.candidate.count({ where: { scoutDeliverySlotId: { not: null } } });
  console.log(`\n[検証] 紐付き Candidate 総数: ${finalLinked}`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(1);
});
