/**
 * CA別「提案数」と「提案→エントリー転換率」の分解集計（単発・読み取り専用）
 *
 * 実行: npx tsx scripts/analyze-proposal-to-entry.ts
 * 出力: scripts/output/proposal-to-entry-by-ca.csv        … CA別サマリ
 *       scripts/output/proposal-count-distribution.csv    … 提案数バケット別の到達率
 *       scripts/output/proposal-to-entry-by-ca-gender.csv … CA×性別サマリ
 *       いずれも UTF-8 BOM 付き。ファイル1と2は標準出力にも表示する。
 *
 * ※ SELECT のみ。既存テーブル・カラム・API・UI には一切変更を加えない。
 *
 * ============================================================================
 * 目的（前回 analyze-funnel-by-ca.ts の結果を受けた原因分解）
 * ============================================================================
 * CA間の最大の差は「面談→エントリー」に出た（大野 0.394 / 岡田 0.285 / 安藤 0.276）。
 * この差が
 *   仮説A: そもそも提案（求人紹介）件数が少ない
 *   仮説B: 提案はするが応募（エントリー）に転換しない
 * のどちらに由来するかを、以下の2指標を並べて判別する。
 *   - 提案数中央値（＝1人あたり何件提案しているか）      → 差が大きければ仮説A寄り
 *   - 件数ベース転換率（＝提案1件がエントリーに化ける率） → 差が大きければ仮説B寄り
 *
 * ============================================================================
 * 定義（analyze-funnel-by-ca.ts をそのまま踏襲）
 * ============================================================================
 * - 分母コホート: 期間内に status="complete" の面談を1件以上持つ求職者の実人数。
 *   draft は日程調整AIの仮予約プレースホルダのため除外。テスト求職者（5999番台・氏名にテスト等）除外。
 * - 担当CA: Candidate.employeeId → Employee.name（履歴を持たないため現在値＝最新の担当CA）。
 * - 「提案」= JobEntry レコード1件。entryFlag="求人紹介" を含む全レコードが提案にあたる。
 * - 「エントリー到達」= フラグランク（求人紹介0 / エントリー1 / 書類選考2 / 面接3 / 内定4 / 入社済5）と
 *   日付カラムの OR で「その段階以降に到達したことがあるか」を判定（stagesOfEntry）。前回と同一。
 * - entryFlagDetail による除外は行わない（`notIn` は NULL が不定になるため素で使わない方針も同一）。
 *
 * 指標の注意:
 * - 「提案数中央値・平均」は提案あり者のみを母集団とする（0件の人を含めると中央値が潰れるため）。
 * - 「提案あり→エントリー率」は人ベース、「件数ベース転換率」は JobEntry 件数ベース。前者は
 *   「1件でも応募したか」、後者は「提案の打率」を見る。両者は分母が違うので併記して比較する。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { config as loadEnv } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

loadEnv();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/* ========== 設定（analyze-funnel-by-ca.ts と同一） ========== */

const START_DATE = new Date("2024-11-01T00:00:00+09:00");
const END_DATE = new Date();

const TEST_NUMBER_PREFIX = "5999";
const TEST_NAME_PATTERN = /テスト|ダミー|test/i;
function isTestCandidate(c: { candidateNumber: string; name: string }): boolean {
  return c.candidateNumber.startsWith(TEST_NUMBER_PREFIX) || TEST_NAME_PATTERN.test(c.name);
}

const FLAG_RANK: Record<string, number> = {
  求人紹介: 0,
  検討中: 0,
  エントリー: 1,
  書類選考: 2,
  面接: 3,
  内定: 4,
  入社済: 5,
};
const RANK_ENTRY = 1;
const RANK_INTERVIEW = 3;
const RANK_OFFER = 4;

function flagRank(flag: string | null): number {
  if (!flag) return 0;
  return FLAG_RANK[flag] ?? 0;
}

const OUT_DIR = path.join("scripts", "output");

// 前回スクリプト（funnel-by-ca.csv）のエントリー到達人数。検算の期待値。
const PREV_ENTRY_COUNTS: Record<string, number> = {
  "安藤 嘉富": 248,
  "岡田 愛子": 156,
  "大野 将幸": 215,
  "南條 雄三": 32,
};
const PREV_ENTRY_TOTAL = 661;

/* ========== ヘルパー ========== */

const GENDER_LABELS = ["男性", "女性", "不明"] as const;
type GenderLabel = (typeof GENDER_LABELS)[number];

function toGenderLabel(gender: string | null): GenderLabel {
  if (gender === "male") return "男性";
  if (gender === "female") return "女性";
  return "不明";
}

function rate(numerator: number, denominator: number): string {
  if (denominator === 0) return "";
  return (numerator / denominator).toFixed(3);
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

type EntryRow = {
  candidateId: string;
  entryFlag: string | null;
  documentSubmitDate: Date | null;
  documentPassDate: Date | null;
  firstInterviewDate: Date | null;
  secondInterviewDate: Date | null;
  finalInterviewDate: Date | null;
  offerDate: Date | null;
  offerMeetingDate: Date | null;
  acceptanceDate: Date | null;
};

/** JobEntry 1件が「エントリー以上に到達したことがあるか」。analyze-funnel-by-ca.ts と同一判定。 */
function reachedEntry(e: EntryRow): boolean {
  const rank = flagRank(e.entryFlag);
  const accept = e.acceptanceDate != null;
  const offer = accept || e.offerDate != null || e.offerMeetingDate != null || rank >= RANK_OFFER;
  const interview =
    offer ||
    e.firstInterviewDate != null ||
    e.secondInterviewDate != null ||
    e.finalInterviewDate != null ||
    rank >= RANK_INTERVIEW;
  return (
    interview || e.documentSubmitDate != null || e.documentPassDate != null || rank >= RANK_ENTRY
  );
}

/* ========== 集計の型 ========== */

type Agg = {
  label: string;
  gender?: GenderLabel;
  interviewed: number; // 面談実施人数（コホート分母）
  withProposal: number; // 提案あり人数
  proposalTotal: number; // 提案件数合計
  proposalCounts: number[]; // 提案あり者の1人あたり件数（中央値・平均用）
  entryReached: number; // エントリー到達人数
  entryReachedEntries: number; // エントリー以上に到達した JobEntry 件数
};

function emptyAgg(label: string, gender?: GenderLabel): Agg {
  return {
    label,
    gender,
    interviewed: 0,
    withProposal: 0,
    proposalTotal: 0,
    proposalCounts: [],
    entryReached: 0,
    entryReachedEntries: 0,
  };
}

function addCandidate(
  a: Agg,
  stat: { count: number; reachedEntries: number; hasEntry: boolean },
) {
  a.interviewed += 1;
  a.proposalTotal += stat.count;
  a.entryReachedEntries += stat.reachedEntries;
  if (stat.count > 0) {
    a.withProposal += 1;
    a.proposalCounts.push(stat.count);
  }
  if (stat.hasEntry) a.entryReached += 1;
}

const SUMMARY_HEADERS = [
  "面談実施人数",
  "提案あり人数",
  "提案あり率",
  "提案件数合計",
  "提案数中央値",
  "提案数平均",
  "エントリー到達人数",
  "提案あり→エントリー率",
  "件数ベース転換率",
];

function summaryHeaders(withGender: boolean): string[] {
  return withGender ? ["CA", "性別", ...SUMMARY_HEADERS] : ["CA", ...SUMMARY_HEADERS];
}

function summaryCells(a: Agg, withGender: boolean): (string | number)[] {
  const cells: (string | number)[] = [a.label];
  if (withGender) cells.push(a.gender ?? "");
  cells.push(
    a.interviewed,
    a.withProposal,
    rate(a.withProposal, a.interviewed),
    a.proposalTotal,
    median(a.proposalCounts),
    a.proposalCounts.length === 0 ? "" : (a.proposalTotal / a.proposalCounts.length).toFixed(1),
    a.entryReached,
    rate(a.entryReached, a.withProposal),
    rate(a.entryReachedEntries, a.proposalTotal),
  );
  return cells;
}

/* ========== 提案数バケット ========== */

const BUCKETS = [
  { label: "0", test: (n: number) => n === 0 },
  { label: "1-5", test: (n: number) => n >= 1 && n <= 5 },
  { label: "6-10", test: (n: number) => n >= 6 && n <= 10 },
  { label: "11-20", test: (n: number) => n >= 11 && n <= 20 },
  { label: "21+", test: (n: number) => n >= 21 },
];
function bucketOf(n: number): string {
  return BUCKETS.find((b) => b.test(n))?.label ?? "0";
}

/* ========== 出力ヘルパー ========== */

function writeCsv(file: string, headerRow: string[], rows: (string | number)[][]) {
  const lines = [headerRow.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, file), "﻿" + lines.join("\r\n") + "\r\n", "utf8");
}

function printTable(title: string, headerRow: string[], rows: (string | number)[][]) {
  const table = [headerRow, ...rows.map((r) => r.map(String))];
  const width = (s: string) => [...s].reduce((n, ch) => n + (/[\x00-\xff]/.test(ch) ? 1 : 2), 0);
  const colWidths = headerRow.map((_, i) => Math.max(...table.map((row) => width(row[i] ?? ""))));
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - width(s)));
  console.log(`\n===== ${title} =====`);
  table.forEach((row, idx) => {
    console.log(row.map((cell, i) => pad(cell ?? "", colWidths[i])).join("  "));
    if (idx === 0) console.log(colWidths.map((w) => "-".repeat(w)).join("  "));
  });
}

/* ========== 本体 ========== */

async function main() {
  console.log(
    `集計期間: ${START_DATE.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })} 〜 ` +
      `${END_DATE.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })}（JST）`,
  );

  // ---- コホート ----
  const interviews = await prisma.interviewRecord.findMany({
    where: { status: "complete", interviewDate: { gte: START_DATE, lte: END_DATE } },
    select: { candidateId: true },
  });
  const interviewedIds = new Set(interviews.map((i) => i.candidateId).filter(Boolean));
  console.log(`面談レコード: ${interviews.length}件(complete) / 対象求職者 ${interviewedIds.size}人`);
  if (interviewedIds.size === 0) {
    console.log("対象となる面談がありません。処理を終了します。");
    return;
  }

  const candidates = await prisma.candidate.findMany({
    where: { id: { in: [...interviewedIds] } },
    select: {
      id: true,
      candidateNumber: true,
      name: true,
      gender: true,
      employee: { select: { name: true } },
    },
  });
  const targets = candidates.filter((c) => !isTestCandidate(c));
  const excludedTest = candidates.length - targets.length;
  if (excludedTest > 0) console.log(`テスト・ダミー求職者 ${excludedTest}人を除外しました。`);

  // ---- コホートの JobEntry（＝提案）----
  const targetIds = targets.map((c) => c.id);
  const entries = (await prisma.jobEntry.findMany({
    where: { candidateId: { in: targetIds } },
    select: {
      candidateId: true,
      entryFlag: true,
      documentSubmitDate: true,
      documentPassDate: true,
      firstInterviewDate: true,
      secondInterviewDate: true,
      finalInterviewDate: true,
      offerDate: true,
      offerMeetingDate: true,
      acceptanceDate: true,
    },
  })) as EntryRow[];
  console.log(`コホートの JobEntry（提案）: ${entries.length}件`);

  // ---- 求職者ごとの提案件数・到達件数 ----
  const perCandidate = new Map<string, { count: number; reachedEntries: number; hasEntry: boolean }>();
  for (const id of targetIds) perCandidate.set(id, { count: 0, reachedEntries: 0, hasEntry: false });
  for (const e of entries) {
    const st = perCandidate.get(e.candidateId);
    if (!st) continue; // コホート外は無視（where で絞っているので通常起きない）
    st.count += 1;
    if (reachedEntry(e)) {
      st.reachedEntries += 1;
      st.hasEntry = true;
    }
  }

  // ---- 集計（CA別 / CA×性別）----
  const caNames = new Set<string>();
  const byCa = new Map<string, Agg>();
  const byCaGender = new Map<string, Agg>();
  const distribution = new Map<string, { count: number; entry: number }>(); // `${ca} ${bucket}`

  for (const c of targets) {
    const ca = c.employee?.name ?? "(未割当)";
    const g = toGenderLabel(c.gender);
    caNames.add(ca);
    const stat = perCandidate.get(c.id) ?? { count: 0, reachedEntries: 0, hasEntry: false };

    const caAgg = byCa.get(ca) ?? emptyAgg(ca);
    addCandidate(caAgg, stat);
    byCa.set(ca, caAgg);

    const gKey = `${ca} ${g}`;
    const gAgg = byCaGender.get(gKey) ?? emptyAgg(ca, g);
    addCandidate(gAgg, stat);
    byCaGender.set(gKey, gAgg);

    const bKey = `${ca} ${bucketOf(stat.count)}`;
    const b = distribution.get(bKey) ?? { count: 0, entry: 0 };
    b.count += 1;
    if (stat.hasEntry) b.entry += 1;
    distribution.set(bKey, b);
  }

  const sortedCas = [...caNames].sort((a, b) => a.localeCompare(b, "ja"));

  // 全社合計（提案数の中央値は全個人の分布から算出するため proposalCounts を連結する）
  const buildTotal = (aggs: Agg[], label: string, gender?: GenderLabel): Agg => {
    const t = emptyAgg(label, gender);
    for (const a of aggs) {
      t.interviewed += a.interviewed;
      t.withProposal += a.withProposal;
      t.proposalTotal += a.proposalTotal;
      t.entryReached += a.entryReached;
      t.entryReachedEntries += a.entryReachedEntries;
      t.proposalCounts.push(...a.proposalCounts);
    }
    return t;
  };

  const caAggs = sortedCas.map((ca) => byCa.get(ca) ?? emptyAgg(ca));
  const totalAgg = buildTotal(caAggs, "全社合計");

  // ---- ファイル1: CA別サマリ ----
  const summaryRows = [...caAggs, totalAgg].map((a) => summaryCells(a, false));
  writeCsv("proposal-to-entry-by-ca.csv", summaryHeaders(false), summaryRows);

  // ---- ファイル2: 提案数の分布 ----
  const distHeaders = ["CA", "提案数バケット", "求職者数", "エントリー到達人数", "到達率"];
  const distRows: (string | number)[][] = [];
  for (const ca of sortedCas) {
    for (const b of BUCKETS) {
      const d = distribution.get(`${ca} ${b.label}`) ?? { count: 0, entry: 0 };
      distRows.push([ca, b.label, d.count, d.entry, rate(d.entry, d.count)]);
    }
  }
  // 全社合計もバケット別に出す
  for (const b of BUCKETS) {
    let count = 0;
    let entry = 0;
    for (const ca of sortedCas) {
      const d = distribution.get(`${ca} ${b.label}`);
      if (!d) continue;
      count += d.count;
      entry += d.entry;
    }
    distRows.push(["全社合計", b.label, count, entry, rate(entry, count)]);
  }
  writeCsv("proposal-count-distribution.csv", distHeaders, distRows);

  // ---- ファイル3: CA×性別 ----
  const genderRows: (string | number)[][] = [];
  for (const ca of sortedCas) {
    for (const g of GENDER_LABELS) {
      genderRows.push(summaryCells(byCaGender.get(`${ca} ${g}`) ?? emptyAgg(ca, g), true));
    }
  }
  for (const g of GENDER_LABELS) {
    const aggs = sortedCas
      .map((ca) => byCaGender.get(`${ca} ${g}`))
      .filter((x): x is Agg => Boolean(x));
    genderRows.push(summaryCells(buildTotal(aggs, "全社合計", g), true));
  }
  writeCsv("proposal-to-entry-by-ca-gender.csv", summaryHeaders(true), genderRows);

  console.log(
    `\nCSV を出力しました: ${OUT_DIR}/proposal-to-entry-by-ca.csv / proposal-count-distribution.csv / proposal-to-entry-by-ca-gender.csv`,
  );

  printTable("CA別 提案→エントリー分解", summaryHeaders(false), summaryRows);
  printTable("提案数バケット別の到達率", distHeaders, distRows);

  /* ========== 判別ロジック（数値の並記のみ・断定はしない） ========== */
  console.log("\n===== 仮説A/B 判別のための指標比較 =====");
  const named = caAggs.filter((a) => a.withProposal > 0);
  const medians = named.map((a) => ({ ca: a.label, v: median(a.proposalCounts) }));
  const convs = named.map((a) => ({
    ca: a.label,
    v: a.proposalTotal === 0 ? 0 : a.entryReachedEntries / a.proposalTotal,
  }));
  const spread = (xs: { ca: string; v: number }[]) => {
    const sorted = [...xs].sort((a, b) => b.v - a.v);
    const hi = sorted[0];
    const lo = sorted[sorted.length - 1];
    return { hi, lo, ratio: lo.v === 0 ? Infinity : hi.v / lo.v };
  };
  const ms = spread(medians);
  const cs = spread(convs);
  console.log(
    `提案数中央値（仮説A指標）: ` +
      medians.map((m) => `${m.ca}=${m.v}`).join(" / ") +
      `\n  最大 ${ms.hi.ca}=${ms.hi.v} ・ 最小 ${ms.lo.ca}=${ms.lo.v} ・ 倍率 ${ms.ratio.toFixed(2)}x`,
  );
  console.log(
    `件数ベース転換率（仮説B指標）: ` +
      convs.map((c) => `${c.ca}=${c.v.toFixed(3)}`).join(" / ") +
      `\n  最大 ${cs.hi.ca}=${cs.hi.v.toFixed(3)} ・ 最小 ${cs.lo.ca}=${cs.lo.v.toFixed(3)} ・ 倍率 ${cs.ratio.toFixed(2)}x`,
  );
  console.log(
    `※ 倍率が大きい側の指標に差の主因がある。両方大きければ両方が効いている（判断は数値を見て行うこと）。`,
  );

  /* ========== 検算 ========== */
  console.log("\n===== 検算 =====");
  let ng = 0;

  // (1) エントリー到達人数が前回スクリプト（funnel-by-ca.csv）と一致するか
  const mismatches: string[] = [];
  for (const [ca, expected] of Object.entries(PREV_ENTRY_COUNTS)) {
    const actual = byCa.get(ca)?.entryReached;
    if (actual !== expected) mismatches.push(`${ca}: 今回${actual} vs 前回${expected}`);
  }
  if (totalAgg.entryReached !== PREV_ENTRY_TOTAL) {
    mismatches.push(`全社合計: 今回${totalAgg.entryReached} vs 前回${PREV_ENTRY_TOTAL}`);
  }
  if (mismatches.length > 0) ng++;
  console.log(
    `(1) エントリー到達人数の前回一致: ${mismatches.length === 0 ? "一致（安藤248/岡田156/大野215/南條32/全社661）" : `不一致 → ${mismatches.join(", ")}`}`,
  );

  // (2) 提案あり人数 >= エントリー到達人数 が全行で成立するか
  const allAggs = [...caAggs, totalAgg, ...byCaGender.values()];
  const invalid = allAggs.filter((a) => a.withProposal < a.entryReached);
  if (invalid.length > 0) ng++;
  console.log(
    `(2) 提案あり人数 >= エントリー到達人数: ${invalid.length === 0 ? "全行OK" : `違反 ${invalid.length}行 → ${invalid.map((v) => `${v.label}${v.gender ?? ""}`).join(", ")}`}`,
  );

  // (3) 分布表の求職者数合計 = 面談実施人数
  let distSum = 0;
  for (const d of distribution.values()) distSum += d.count;
  const okDist = distSum === totalAgg.interviewed;
  if (!okDist) ng++;
  console.log(
    `(3) 分布表の求職者数合計=${distSum} / 面談実施人数=${totalAgg.interviewed} → ${okDist ? "一致" : "不一致"}`,
  );

  console.log(ng === 0 ? "\n検算: 問題なし" : `\n検算: ${ng}件の不一致あり（上記参照）`);
}

main()
  .catch((e) => {
    console.error("集計に失敗しました:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
