/**
 * T-135 step7: 電話番号照合による求職者⇔スカウトNO再紐付け（portal正・全期間・二段照合）
 *
 * FM対応表（スカウトNO/求職者NO/氏名/電話番号/配信日）を読み、portal の求職者に
 * scoutNumber / scoutDeliverySlotId / scoutDeliveryDate を再紐付けする。
 * FM の求職者NOは portal の candidateNumber と別体系のため照合キーに使わない（罠）。
 *
 * 二段照合（承認済み方針）:
 *   第一段=電話: 正規化（全角→半角・数字以外除去・10桁で90/80/70始まりは先頭0補完）で完全一致。
 *     - portal側同一電話×複数求職者 → 氏名（正規化）で解決、決まらなければスキップ(明細)
 *     - FM側同一電話×異なるSC → スキップ(明細)。同一SCの重複行は1件扱い
 *   第二段=氏名: 電話で未解決の FM 行のみ。氏名は NFKC＋空白（半角/全角）除去で完全一致のみ。
 *     - FM側 or portal側で同名が複数存在する名前 → 照合せずスキップ(明細)
 *     - FMの配信日 > portal の applicationDate → 別人疑いスキップ(明細)
 *     - 第一段で既に割当済みの求職者に別のFM行が氏名一致 → 競合スキップ(明細)
 *
 * 書き込み（execute時のみ・Candidate の3カラム以外非接触）:
 *   scoutNumber   = FM のスカウトNO（上書き。旧値は信用しない）
 *   scoutDeliverySlotId = ScoutDeliverySlot.scoutNumber 一意検索の枠id（枠なしは null）
 *   scoutDeliveryDate   = 枠の deliveryDate（枠なしは FM 配信日で補完。両方なしは null）
 *   ※解除（旧SCの是正）は「電話一致で FM と別 SC だった人」への上書きとして実現する。
 *     照合不一致だけを根拠にした scoutNumber の null 化は行わない（電話欠損≠誤マッチのため）。
 *
 * 氏名監査（読み取りのみ・毎回実施）:
 *   現在 scoutNumber を持つ全求職者について、FM の同SC行の氏名と突合し
 *   NAME_MATCH / NAME_MISMATCH / SC_NOT_IN_FM を監査CSVに出力（既存紐付けの信頼性測定）。
 *
 * 実行（ローカル・DATABASE_URL は本番。xlsx がローカルにあるため railway ssh では実行しない）:
 *   npx tsx scripts/relink-by-phone-t135.ts                 # DRY-RUN（既定・書き込みなし）
 *   npx tsx scripts/relink-by-phone-t135.ts --execute       # 本実行（ロールバックCSV保存→UPDATE）
 *   npx tsx scripts/relink-by-phone-t135.ts --file <path>   # 入力xlsxパス上書き
 *
 * 罠#17: 日付は UTC 00:00=JST暦日 で保存・比較。toISOString().slice(0,10) は使わない。
 * 電話番号は明細/計画CSVでは下4桁のみにマスク（ロールバックCSVには電話自体を含めない）。
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

// ---- 引数 ----
const argv = process.argv.slice(2);
const EXECUTE = argv.includes("--execute");
const MODE = EXECUTE ? "EXECUTE" : "DRY-RUN";
function argVal(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const FILE_PATH = argVal("--file") ?? "C:/bizstudio/import-data/スカウトNO引き当て用.xlsx";

// ---- 正規化 ----
function normPhone(p: unknown): string {
  if (p == null) return "";
  let s = String(p).replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  s = s.replace(/[^0-9]/g, "");
  if (s.length === 10 && /^(90|80|70)/.test(s)) s = "0" + s; // Excel先頭0落ち対策
  return s;
}
function normName(n: unknown): string {
  return String(n ?? "").normalize("NFKC").replace(/[\s　]/g, "");
}
function maskPhone(p: string): string {
  return p.length >= 4 ? "****" + p.slice(-4) : "****";
}
// Excelシリアル値 → UTC 00:00 の Date（= JST暦日保存規約・罠#17準拠）
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
function serialToDate(v: unknown): Date | null {
  if (typeof v === "number" && v > 20000 && v < 60000) return new Date(EXCEL_EPOCH_MS + v * 86400000);
  if (typeof v === "string" && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v)) {
    const m = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)!;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  return null;
}
// 罠#17: UTC getter で YYYY-MM-DD 化（toISOString禁止）
function fmtDate(d: Date | null): string {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
function nowStamp(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}
function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const JUNE_START = (Date.UTC(2026, 5, 1) - EXCEL_EPOCH_MS) / 86400000;
const JUNE_END = (Date.UTC(2026, 5, 30) - EXCEL_EPOCH_MS) / 86400000;

// ---- 型 ----
type FmRow = {
  idx: number; // 元行番号（2始まり=ヘッダ次行）
  sc: string;
  phone: string; // 正規化済み（無効は ""）
  name: string; // 正規化済み
  rawName: string;
  dateSerial: number | null;
  date: Date | null;
  isJune: boolean;
};
type Cand = {
  id: string;
  candidateNumber: string;
  name: string;
  phone: string | null;
  applicationDate: Date | null;
  scoutNumber: string | null;
  scoutDeliverySlotId: string | null;
  scoutDeliveryDate: Date | null;
};
type Assignment = {
  cand: Cand;
  fm: FmRow;
  via: "phone" | "name";
  newSlotId: string | null;
  newDate: Date | null;
  kind: "NEW" | "CHANGED" | "SAME";
};
type Skip = {
  stage: string;
  reason: string;
  fmIdx: number;
  sc: string;
  fmName: string;
  phoneMasked: string;
  detail: string;
};

async function main() {
  console.log(`=== T-135 step7 電話→氏名 二段照合 再紐付け (mode=${MODE}) ===`);
  console.log(`入力: ${FILE_PATH}`);
  if (!fs.existsSync(FILE_PATH)) {
    console.error(`入力ファイルがありません: ${FILE_PATH}`);
    process.exit(1);
  }

  // ---- FM リスト読み込み ----
  const wb = XLSX.readFile(FILE_PATH);
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const fmAll: FmRow[] = [];
  let scEmpty = 0;
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const sc = String(r["スカウトNO"] ?? "").trim();
    if (!sc) { scEmpty++; continue; } // 友達紹介等・紐付け対象外
    const ser = typeof r["配信日"] === "number" ? (r["配信日"] as number) : null;
    const date = serialToDate(r["配信日"]);
    const phone = normPhone(r["電話番号"]);
    fmAll.push({
      idx: i + 2,
      sc,
      phone: phone.length >= 10 ? phone : "",
      name: normName(r["求職者氏名_結合"]),
      rawName: String(r["求職者氏名_結合"] ?? "").trim(),
      dateSerial: ser,
      date,
      isJune: ser != null && ser >= JUNE_START && ser <= JUNE_END,
    });
  }
  const juneTotal = fmAll.filter((f) => f.isJune).length;
  console.log(`FM: 総行 ${raw.length} / SC空欄スキップ ${scEmpty} / 有効 ${fmAll.length}（うち2026年6月配信 ${juneTotal}）`);

  // ---- portal データ ----
  const cands: Cand[] = (await prisma.candidate.findMany({
    select: {
      id: true, candidateNumber: true, name: true, phone: true, applicationDate: true,
      scoutNumber: true, scoutDeliverySlotId: true, scoutDeliveryDate: true,
    },
  })) as Cand[];
  const slots = await prisma.scoutDeliverySlot.findMany({
    select: { id: true, scoutNumber: true, deliveryDate: true },
  });
  const slotBySc = new Map(slots.map((s) => [s.scoutNumber, s]));
  console.log(`portal: 求職者 ${cands.length} / 配信枠 ${slots.length}`);

  // ---- インデックス ----
  const candByPhone = new Map<string, Cand[]>();
  const candByName = new Map<string, Cand[]>();
  for (const c of cands) {
    const ph = normPhone(c.phone);
    if (ph.length >= 10) { const a = candByPhone.get(ph) ?? []; a.push(c); candByPhone.set(ph, a); }
    const nm = normName(c.name);
    if (nm) { const a = candByName.get(nm) ?? []; a.push(c); candByName.set(nm, a); }
  }
  const fmByPhone = new Map<string, FmRow[]>();
  const fmByName = new Map<string, FmRow[]>();
  for (const f of fmAll) {
    if (f.phone) { const a = fmByPhone.get(f.phone) ?? []; a.push(f); fmByPhone.set(f.phone, a); }
    if (f.name) { const a = fmByName.get(f.name) ?? []; a.push(f); fmByName.set(f.name, a); }
  }

  const assignments = new Map<string, Assignment>(); // candidateId -> assignment
  const resolvedFmIdx = new Set<number>(); // 割当が成立した FM 行
  const skips: Skip[] = [];
  const skip = (stage: string, reason: string, f: FmRow, detail: string) =>
    skips.push({ stage, reason, fmIdx: f.idx, sc: f.sc, fmName: f.rawName, phoneMasked: maskPhone(f.phone), detail });

  const buildAssign = (cand: Cand, f: FmRow, via: "phone" | "name"): Assignment => {
    const slot = slotBySc.get(f.sc) ?? null;
    const newDate = slot ? slot.deliveryDate : f.date; // 枠なしはFM配信日補完（両方なしはnull）
    const kind: Assignment["kind"] =
      cand.scoutNumber == null ? "NEW" : cand.scoutNumber === f.sc ? "SAME" : "CHANGED";
    return { cand, fm: f, via, newSlotId: slot?.id ?? null, newDate, kind };
  };

  // ---- 第一段: 電話照合（電話単位で処理・同一SC重複は1件扱い） ----
  let phoneAmbiguousA = 0, phoneAmbiguousB = 0, phoneNameResolved = 0;
  for (const [ph, fmRows] of fmByPhone) {
    const scSet = new Set(fmRows.map((f) => f.sc));
    if (scSet.size > 1) { // FM側: 同一電話×異なるSC
      phoneAmbiguousB++;
      for (const f of fmRows) skip("phone", "FM同電話異SC", f, `SC候補=${[...scSet].join("/")}`);
      continue;
    }
    const f = fmRows[0]; // 同一SCなら代表1行
    const cArr = candByPhone.get(ph) ?? [];
    if (cArr.length === 0) continue; // 第二段へ
    let target: Cand | null = null;
    if (cArr.length === 1) target = cArr[0];
    else {
      const byName = cArr.filter((c) => normName(c.name) === f.name);
      if (byName.length === 1) { target = byName[0]; phoneNameResolved++; }
      else {
        phoneAmbiguousA++;
        skip("phone", "portal同電話複数・氏名未解決", f, `候補${cArr.length}名`);
        continue;
      }
    }
    assignments.set(target.id, buildAssign(target, f, "phone"));
    for (const r of fmRows) resolvedFmIdx.add(r.idx);
  }
  const phoneMatched = [...assignments.values()].filter((a) => a.via === "phone").length;

  // ---- 第二段: 氏名照合（電話で未解決の FM 行のみ） ----
  let nameMatched = 0, nameDupSkip = 0, dateConflictSkip = 0, nameConflictSkip = 0;
  const stage2Rows = fmAll.filter((f) => !resolvedFmIdx.has(f.idx));
  // 第二段も「同名FM行が同一SCなら1件扱い」にするため名前単位で処理
  const stage2ByName = new Map<string, FmRow[]>();
  for (const f of stage2Rows) {
    if (!f.name) { skip("name", "FM氏名空欄", f, ""); continue; }
    const a = stage2ByName.get(f.name) ?? []; a.push(f); stage2ByName.set(f.name, a);
  }
  for (const [nm, rows] of stage2ByName) {
    // FM側同名チェックは「有効全行」ベース（未解決行だけでなく全体で同名複数=曖昧）
    const allSame = fmByName.get(nm) ?? rows;
    const scSet = new Set(allSame.map((f) => f.sc));
    if (scSet.size > 1) {
      nameDupSkip += rows.length;
      for (const f of rows) skip("name", "FM側同名複数(異SC)", f, `SC候補=${[...scSet].join("/")}`);
      continue;
    }
    const f = rows[0];
    const cArr = candByName.get(nm) ?? [];
    if (cArr.length === 0) { skip("name", "portal該当なし", f, ""); continue; }
    if (cArr.length > 1) {
      nameDupSkip += rows.length;
      for (const r of rows) skip("name", "portal側同名複数", r, `候補${cArr.length}名`);
      continue;
    }
    const cand = cArr[0];
    if (assignments.has(cand.id)) { // 第一段で別FM行が割当済み
      nameConflictSkip++;
      skip("name", "第一段割当済みと競合", f, `既割当SC=${assignments.get(cand.id)!.fm.sc}`);
      continue;
    }
    // 日付整合: FM配信日 > applicationDate は別人疑い
    if (f.date && cand.applicationDate && f.date.getTime() > cand.applicationDate.getTime()) {
      dateConflictSkip++;
      skip("name", "日付矛盾(配信日>応募日)", f, `配信=${fmtDate(f.date)} 応募=${fmtDate(cand.applicationDate)}`);
      continue;
    }
    assignments.set(cand.id, buildAssign(cand, f, "name"));
    for (const r of rows) resolvedFmIdx.add(r.idx);
    nameMatched++;
  }

  // ---- 集計 ----
  const plan = [...assignments.values()];
  const byKind = { NEW: 0, CHANGED: 0, SAME: 0 };
  for (const a of plan) byKind[a.kind]++;
  const juneCovered = fmAll.filter((f) => f.isJune && resolvedFmIdx.has(f.idx)).length;
  const changedByPhone = plan.filter((a) => a.via === "phone" && a.kind === "CHANGED").length;

  console.log(`\n=== 照合結果サマリ ===`);
  console.log(`  電話一致: ${phoneMatched}名（うち複数候補を氏名で解決 ${phoneNameResolved}）`);
  console.log(`  氏名一致: ${nameMatched}名`);
  console.log(`  合計割当: ${plan.length}名 … 内訳 NEW=${byKind.NEW} / CHANGED(旧SCと別)=${byKind.CHANGED} / SAME=${byKind.SAME}`);
  console.log(`  解除（=電話一致で旧SCと別 → FM値へ上書き是正）: ${changedByPhone}名`);
  console.log(`  同名スキップ: ${nameDupSkip}行（FM側異SC or portal側同名複数）`);
  console.log(`  日付矛盾スキップ(配信日>応募日): ${dateConflictSkip}行`);
  console.log(`  第一段競合スキップ: ${nameConflictSkip}行`);
  console.log(`  電話曖昧: portal複数・未解決(a)=${phoneAmbiguousA}行 / FM同電話異SC(b)=${phoneAmbiguousB}組`);
  console.log(`  2026年6月配信: ${juneTotal}行中 ${juneCovered}行 カバー`);
  const noSlot = plan.filter((a) => !a.newSlotId).length;
  console.log(`  枠なし（scoutNumberのみ・配信日はFM補完）: ${noSlot}名`);

  // ---- 氏名監査（既存 scoutNumber 保持者 vs FM 氏名） ----
  const fmNamesBySc = new Map<string, Set<string>>();
  for (const f of fmAll) {
    const s = fmNamesBySc.get(f.sc) ?? new Set();
    if (f.name) s.add(f.name);
    fmNamesBySc.set(f.sc, s);
  }
  const holders = cands.filter((c) => c.scoutNumber);
  let auditMatch = 0, auditMismatch = 0, auditNotInFm = 0;
  const auditRows: string[] = [["candidateNumber", "name", "scoutNumber", "fmNames", "verdict"].join(",")];
  for (const c of holders) {
    const fmNames = fmNamesBySc.get(c.scoutNumber!);
    let verdict: string;
    if (!fmNames || fmNames.size === 0) { verdict = "SC_NOT_IN_FM"; auditNotInFm++; }
    else if (fmNames.has(normName(c.name))) { verdict = "NAME_MATCH"; auditMatch++; }
    else { verdict = "NAME_MISMATCH"; auditMismatch++; }
    auditRows.push([c.candidateNumber, c.name, c.scoutNumber, fmNames ? [...fmNames].join("|") : "", verdict].map(csvEscape).join(","));
  }
  console.log(`\n=== 氏名監査（既存 scoutNumber 保持 ${holders.length}名 vs FM） ===`);
  console.log(`  NAME_MATCH=${auditMatch} / NAME_MISMATCH=${auditMismatch} / SC_NOT_IN_FM=${auditNotInFm}`);

  // ---- サンプル20件 ----
  console.log(`\n=== サンプル20件（candidateNumber/氏名/電話下4桁/SC/配信日/経路/種別） ===`);
  for (const a of plan.slice(0, 20)) {
    console.log(
      `  ${a.cand.candidateNumber} ${a.cand.name} ${maskPhone(normPhone(a.cand.phone))} ${a.fm.sc} ${fmtDate(a.newDate)} via=${a.via} ${a.kind}`,
    );
  }

  // ---- CSV 出力 ----
  const verifyDir = path.join(process.cwd(), "verify");
  if (!fs.existsSync(verifyDir)) fs.mkdirSync(verifyDir, { recursive: true });
  const stamp = nowStamp();
  const tag = MODE.toLowerCase();

  const planPath = path.join(verifyDir, `t135-phone-relink-plan-${tag}-${stamp}.csv`);
  const planRows = [["candidateId", "candidateNumber", "name", "phoneMasked", "via", "kind", "oldScoutNumber", "newScoutNumber", "newSlotId", "newDeliveryDate", "fmRowIdx"].join(",")];
  for (const a of plan) {
    planRows.push([
      a.cand.id, a.cand.candidateNumber, a.cand.name, maskPhone(normPhone(a.cand.phone)),
      a.via, a.kind, a.cand.scoutNumber, a.fm.sc, a.newSlotId, fmtDate(a.newDate), a.fm.idx,
    ].map(csvEscape).join(","));
  }
  fs.writeFileSync(planPath, planRows.join("\n"), "utf8");
  console.log(`\n計画 CSV: ${planPath}`);

  const skipPath = path.join(verifyDir, `t135-phone-relink-skips-${tag}-${stamp}.csv`);
  const skipRows = [["stage", "reason", "fmRowIdx", "scoutNumber", "fmName", "phoneMasked", "detail"].join(",")];
  for (const s of skips) skipRows.push([s.stage, s.reason, s.fmIdx, s.sc, s.fmName, s.phoneMasked, s.detail].map(csvEscape).join(","));
  fs.writeFileSync(skipPath, skipRows.join("\n"), "utf8");
  console.log(`スキップ明細 CSV: ${skipPath}（${skips.length}行）`);

  const auditPath = path.join(verifyDir, `t135-scout-name-audit-${stamp}.csv`);
  fs.writeFileSync(auditPath, auditRows.join("\n"), "utf8");
  console.log(`氏名監査 CSV: ${auditPath}`);

  if (!EXECUTE) {
    console.log(`\n(DRY-RUN: 書き込み未実行。本実行は --execute を付与。)`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  // ---- EXECUTE ----
  // ロールバックCSV: scoutNumber/slotId/deliveryDate のいずれかが入っている全求職者の現状（変更前・電話なし）
  const rbPath = path.join(verifyDir, `t135-phone-relink-rollback-${stamp}.csv`);
  const rbRows = [["candidateId", "candidateNumber", "scoutNumber", "scoutDeliverySlotId", "scoutDeliveryDate"].join(",")];
  for (const c of cands) {
    if (c.scoutNumber != null || c.scoutDeliverySlotId != null || c.scoutDeliveryDate != null) {
      rbRows.push([c.id, c.candidateNumber, c.scoutNumber, c.scoutDeliverySlotId, fmtDate(c.scoutDeliveryDate)].map(csvEscape).join(","));
    }
  }
  fs.writeFileSync(rbPath, rbRows.join("\n"), "utf8");
  console.log(`\nRollback CSV: ${rbPath}（${rbRows.length - 1}行の変更前状態）`);

  console.log(`\n=== EXECUTE: ${plan.length}名を更新 ===`);
  let ok = 0, err = 0;
  for (const a of plan) {
    try {
      await prisma.candidate.update({
        where: { id: a.cand.id },
        data: {
          scoutNumber: a.fm.sc,
          scoutDeliverySlotId: a.newSlotId,
          scoutDeliveryDate: a.newDate,
        },
      });
      ok++;
    } catch (e) {
      err++;
      console.error(`  ✗ update failed ${a.cand.candidateNumber}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`  更新: 成功=${ok} / 失敗=${err}（期待=${plan.length}）`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch { /* noop */ }
  try { await pool.end(); } catch { /* noop */ }
  process.exit(1);
});
