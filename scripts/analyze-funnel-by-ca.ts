/**
 * CA別「面談 → エントリー → 面接設定 → 内定 → 承諾」ファネル通過率の集計（単発・読み取り専用）
 *
 * 実行: npx tsx scripts/analyze-funnel-by-ca.ts
 * 出力: scripts/output/funnel-by-ca.csv           … CA別（全体）
 *       scripts/output/funnel-by-ca-gender.csv    … CA×性別
 *       scripts/output/funnel-by-ca-excl-haken.csv… 派遣エントリーを除外
 *       いずれも UTF-8 BOM 付き。ファイル1と3は標準出力にも表示する。
 *
 * ※ 本スクリプトは SELECT のみ。既存テーブル・カラム・API・UI には一切変更を加えない。
 * ※ 分母・除外・CA・期間・派遣キーワードの扱いは analyze-decision-rate-by-gender.ts を踏襲。
 *
 * ============================================================================
 * Step 1: 段階判定の調査結果（本番実データの実測値。推測ではない）
 * ============================================================================
 *
 * ● entryFlag の全語彙（実データ・全 28,428 件）
 *     求人紹介 23120 / 書類選考 3135 / 面接 1245 / エントリー 624 / 内定 152 / 入社済 151 / 検討中 1
 *     → UI のタブ順（EntryBoard.tsx L138-143）と一致する段階順序:
 *        求人紹介 < エントリー < 書類選考 < 面接 < 内定 < 入社済
 *     → "検討中" 1 件は本来 entryFlagDetail の語彙が flag 側へ混入したもの。段階不明として
 *        求人紹介と同じ最下位ランク扱いにする（1件のみで集計影響はほぼ無い）。
 *
 * ● entryFlagDetail の全語彙（同上・多い順）
 *     本人辞退 23957 / 選考落ち 3592 / 未応募 242 / (NULL) 151 / クローズ 142 / 選考中 108 /
 *     本人辞退_自社他 91 / 本人辞退_他社決 48 / 送付済本人確認 30 / 検討中 16 / 一次面接実施前 15 /
 *     承諾 10 / 書類見送り 10 / 一次日程調整中 6 / 一次面接選考中 4 / 適性検査受講中 2 /
 *     最終面接実施前 2 / BS作成中 1 / 二次面接選考中 1
 *     → detail は「現在の状態・結果」を表し段階そのものではないため、**段階判定には使わない**。
 *
 * ● 日付カラムの充填状況（全 28,428 件）
 *     jobIntroDate 27538 / documentSubmitDate 4142 / documentPassDate 1567 /
 *     firstInterviewDate 1303 / secondInterviewDate 14 / finalInterviewDate 178 /
 *     offerDate 294 / acceptanceDate 167 / joinDate 162 / firstMeetingDate 0（未使用カラム）
 *     → `entryDate` は NOT NULL で全行に入るため、段階の判別には使えない（求人紹介の行にも入る）。
 *
 * ● 日付とフラグの食い違い（＝どちらか片方だけでは取りこぼす証拠）
 *     entryFlag が面接以降なのに firstInterviewDate 無し : 262 件
 *     entryFlag が内定以降なのに offerDate 無し           : 10 件
 *     acceptanceDate はあるが offerDate 無し              : 3 件
 *     offerDate はあるが firstInterviewDate 無し          : 5 件
 *     逆に entryFlag="求人紹介" でも firstInterviewDate 有 11 件 / offerDate 有 1 件
 *     → **日付とフラグの OR で「到達したことがあるか」を判定する。** どちらか一方では不整合が出る。
 *
 * ● 参考: JobEntry.careerAdvisorId は 28,428 件中 42 件しか入っておらず使い物にならない。
 *     担当CAは指示どおり Candidate.employeeId（現在値）を使う。
 *
 * ============================================================================
 * Step 2: 段階の定義（すべて「その段階以降に到達したことがあるか」で判定）
 * ============================================================================
 *  1. 面談実施  : InterviewRecord が status="complete" で期間内に1件以上（draft は仮予約のため除外）
 *  2. エントリー: flagRank>=エントリー ｜ documentSubmitDate ｜ documentPassDate ｜ 3以降に到達
 *  3. 面接設定  : flagRank>=面接 ｜ firstInterviewDate ｜ secondInterviewDate ｜ finalInterviewDate ｜ 4以降に到達
 *  4. 内定      : flagRank>=内定 ｜ offerDate ｜ offerMeetingDate ｜ 5に到達
 *  5. 承諾      : acceptanceDate のみ（joinDate / flagRank>=入社済 は OR しない。理由は stagesOfEntry 参照）
 *
 *  - 集計単位は求職者の実人数。1人が複数エントリーを持つ場合、各段階は「1件でも到達していれば1」。
 *  - 判定後に後段→前段へ OR を伝播させ、単調減少（後段 <= 前段）を構造的に保証する。
 *  - entryFlagDetail による除外は行わない（承諾は acceptanceDate をそのまま採用）。
 *    ※前回スクリプトは「承諾後に辞退した3人」を決定から除外していたため、承諾人数が3人少ない。
 *      本スクリプトは検算指示（acceptanceDate IS NOT NULL の実人数と一致）に合わせ除外しない。
 *  - `notIn` は使わない（entryFlagDetail は NULL が大量にあり NULL NOT IN (...) が不定になるため）。
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

/* ========== 設定（analyze-decision-rate-by-gender.ts と同一） ========== */

const START_DATE = new Date("2024-11-01T00:00:00+09:00");
const END_DATE = new Date();

const HAKEN_KEYWORDS = [
  "スタッフサービス",
  "マンパワー",
  "リクルートスタッフィング",
  "アデコ",
  "パソナ",
  "マイナビワークス",
  "パーソルテンプスタッフ",
  "テンプスタッフ",
  "ウィルオブ",
  "ランスタッド",
  "フェローシップ",
];

const TEST_NUMBER_PREFIX = "5999";
const TEST_NAME_PATTERN = /テスト|ダミー|test/i;
function isTestCandidate(c: { candidateNumber: string; name: string }): boolean {
  return c.candidateNumber.startsWith(TEST_NUMBER_PREFIX) || TEST_NAME_PATTERN.test(c.name);
}

// entryFlag の段階ランク。未知値・"検討中" は 0（求人紹介と同等＝エントリー未到達）扱い。
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

/* ========== ヘルパー ========== */

const GENDER_LABELS = ["男性", "女性", "不明"] as const;
type GenderLabel = (typeof GENDER_LABELS)[number];

function toGenderLabel(gender: string | null): GenderLabel {
  if (gender === "male") return "男性";
  if (gender === "female") return "女性";
  return "不明";
}

function isHaken(companyName: string | null): boolean {
  if (!companyName) return false;
  return HAKEN_KEYWORDS.some((kw) => companyName.includes(kw));
}

/** 通過率。分母0のときは空文字（0%と誤読させないため）。 */
function rate(numerator: number, denominator: number): string {
  if (denominator === 0) return "";
  return (numerator / denominator).toFixed(3);
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 求職者1人分の到達段階。 */
type Stages = { entry: boolean; interview: boolean; offer: boolean; accept: boolean };

type EntryRow = {
  candidateId: string;
  companyName: string | null;
  entryFlag: string | null;
  documentSubmitDate: Date | null;
  documentPassDate: Date | null;
  firstInterviewDate: Date | null;
  secondInterviewDate: Date | null;
  finalInterviewDate: Date | null;
  offerDate: Date | null;
  offerMeetingDate: Date | null;
  acceptanceDate: Date | null;
  joinDate: Date | null;
};

/** JobEntry 1件が各段階に到達しているか。後段→前段の OR 伝播込み。 */
function stagesOfEntry(e: EntryRow): Stages {
  const rank = flagRank(e.entryFlag);
  // 承諾は acceptanceDate のみで判定する。joinDate や entryFlag="入社済" を OR してはいけない:
  //   - entryFlag="入社済" 151件は全件 acceptanceDate があるため OR しても増えない（＝不要）。
  //   - joinDate を OR すると、entryFlagDetail="本人辞退_他社決"（他社決定で辞退）なのに
  //     joinDate だけが残存している 3 件を誤って承諾に数えてしまう（実測で検算が 124 vs 122 に不一致）。
  const accept = e.acceptanceDate != null;
  const offer = accept || e.offerDate != null || e.offerMeetingDate != null || rank >= RANK_OFFER;
  const interview =
    offer ||
    e.firstInterviewDate != null ||
    e.secondInterviewDate != null ||
    e.finalInterviewDate != null ||
    rank >= RANK_INTERVIEW;
  const entry =
    interview || e.documentSubmitDate != null || e.documentPassDate != null || rank >= RANK_ENTRY;
  return { entry, interview, offer, accept };
}

type Row = {
  label: string;
  gender?: GenderLabel;
  interviewed: number;
  entry: number;
  interview: number;
  offer: number;
  accept: number;
};

function emptyRow(label: string, gender?: GenderLabel): Row {
  return { label, gender, interviewed: 0, entry: 0, interview: 0, offer: 0, accept: 0 };
}

function addTo(row: Row, s: Stages | null) {
  row.interviewed += 1;
  if (!s) return;
  if (s.entry) row.entry += 1;
  if (s.interview) row.interview += 1;
  if (s.offer) row.offer += 1;
  if (s.accept) row.accept += 1;
}

const BASE_HEADERS = ["面談実施", "エントリー", "面接設定", "内定", "承諾"];
const RATE_HEADERS = [
  "面談→エントリー率",
  "エントリー→面接率",
  "面接→内定率",
  "内定→承諾率",
  "面談→承諾率",
];

function rowCells(r: Row, withGender: boolean): (string | number)[] {
  const cells: (string | number)[] = [r.label];
  if (withGender) cells.push(r.gender ?? "");
  cells.push(
    r.interviewed,
    r.entry,
    r.interview,
    r.offer,
    r.accept,
    rate(r.entry, r.interviewed),
    rate(r.interview, r.entry),
    rate(r.offer, r.interview),
    rate(r.accept, r.offer),
    rate(r.accept, r.interviewed),
  );
  return cells;
}

function headers(withGender: boolean): string[] {
  return withGender
    ? ["CA", "性別", ...BASE_HEADERS, ...RATE_HEADERS]
    : ["CA", ...BASE_HEADERS, ...RATE_HEADERS];
}

function writeCsv(file: string, rows: Row[], withGender: boolean) {
  const lines = [headers(withGender).map(csvCell).join(",")];
  for (const r of rows) lines.push(rowCells(r, withGender).map(csvCell).join(","));
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, file), "﻿" + lines.join("\r\n") + "\r\n", "utf8");
}

function printTable(title: string, rows: Row[], withGender: boolean) {
  const head = headers(withGender);
  const table = [head, ...rows.map((r) => rowCells(r, withGender).map(String))];
  const width = (s: string) => [...s].reduce((n, ch) => n + (/[\x00-\xff]/.test(ch) ? 1 : 2), 0);
  const colWidths = head.map((_, i) => Math.max(...table.map((row) => width(row[i]))));
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - width(s)));
  console.log(`\n===== ${title} =====`);
  table.forEach((row, idx) => {
    console.log(row.map((cell, i) => pad(cell, colWidths[i])).join("  "));
    if (idx === 0) console.log(colWidths.map((w) => "-".repeat(w)).join("  "));
  });
}

/* ========== 本体 ========== */

async function main() {
  console.log(
    `集計期間: ${START_DATE.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })} 〜 ` +
      `${END_DATE.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })}（JST）`,
  );

  // ---- 分母: 期間内に実施済み(complete)の面談を持つ求職者 ----
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

  // ---- 対象者の JobEntry を一括取得 ----
  const targetIds = targets.map((c) => c.id);
  const entries = (await prisma.jobEntry.findMany({
    where: { candidateId: { in: targetIds } },
    select: {
      candidateId: true,
      companyName: true,
      entryFlag: true,
      documentSubmitDate: true,
      documentPassDate: true,
      firstInterviewDate: true,
      secondInterviewDate: true,
      finalInterviewDate: true,
      offerDate: true,
      offerMeetingDate: true,
      acceptanceDate: true,
      joinDate: true,
    },
  })) as EntryRow[];
  console.log(`対象者の JobEntry: ${entries.length}件`);

  // ---- 求職者ごとに段階を集約（全体版 / 派遣除外版）----
  const merge = (acc: Stages | undefined, s: Stages): Stages => ({
    entry: (acc?.entry ?? false) || s.entry,
    interview: (acc?.interview ?? false) || s.interview,
    offer: (acc?.offer ?? false) || s.offer,
    accept: (acc?.accept ?? false) || s.accept,
  });

  const byCandidate = new Map<string, Stages>();
  const byCandidateExclHaken = new Map<string, Stages>();
  let hakenEntryCount = 0;
  for (const e of entries) {
    const s = stagesOfEntry(e);
    byCandidate.set(e.candidateId, merge(byCandidate.get(e.candidateId), s));
    if (isHaken(e.companyName)) {
      hakenEntryCount += 1;
      continue; // 派遣除外版では、このエントリーを段階判定に使わない
    }
    byCandidateExclHaken.set(e.candidateId, merge(byCandidateExclHaken.get(e.candidateId), s));
  }
  console.log(`派遣キーワードに一致したエントリー: ${hakenEntryCount}件（除外版で不算入）`);

  // ---- 集計 ----
  const build = (stageMap: Map<string, Stages>, withGender: boolean): Row[] => {
    const map = new Map<string, Row>();
    const caNames = new Set<string>();
    for (const c of targets) {
      const ca = c.employee?.name ?? "(未割当)";
      caNames.add(ca);
      const g = toGenderLabel(c.gender);
      const key = withGender ? `${ca} ${g}` : ca;
      const row = map.get(key) ?? emptyRow(ca, withGender ? g : undefined);
      addTo(row, stageMap.get(c.id) ?? null);
      map.set(key, row);
    }
    const sortedCas = [...caNames].sort((a, b) => a.localeCompare(b, "ja"));
    const out: Row[] = [];
    for (const ca of sortedCas) {
      if (withGender) {
        for (const g of GENDER_LABELS) out.push(map.get(`${ca} ${g}`) ?? emptyRow(ca, g));
      } else {
        out.push(map.get(ca) ?? emptyRow(ca));
      }
    }
    // 全社合計
    const total = emptyRow("全社合計", withGender ? undefined : undefined);
    for (const r of out) {
      total.interviewed += r.interviewed;
      total.entry += r.entry;
      total.interview += r.interview;
      total.offer += r.offer;
      total.accept += r.accept;
    }
    if (withGender) {
      for (const g of GENDER_LABELS) {
        const t = emptyRow("全社合計", g);
        for (const r of out) {
          if (r.gender !== g) continue;
          t.interviewed += r.interviewed;
          t.entry += r.entry;
          t.interview += r.interview;
          t.offer += r.offer;
          t.accept += r.accept;
        }
        out.push(t);
      }
      const grand = { ...total, label: "全社合計", gender: "全体" as GenderLabel };
      out.push(grand);
    } else {
      out.push(total);
    }
    return out;
  };

  const rowsAll = build(byCandidate, false);
  const rowsGender = build(byCandidate, true);
  const rowsExclHaken = build(byCandidateExclHaken, false);

  writeCsv("funnel-by-ca.csv", rowsAll, false);
  writeCsv("funnel-by-ca-gender.csv", rowsGender, true);
  writeCsv("funnel-by-ca-excl-haken.csv", rowsExclHaken, false);
  console.log(`\nCSV を出力しました: ${OUT_DIR}/funnel-by-ca.csv / funnel-by-ca-gender.csv / funnel-by-ca-excl-haken.csv`);

  printTable("CA別ファネル（全体）", rowsAll, false);
  printTable("CA別ファネル（派遣を除く）", rowsExclHaken, false);

  /* ========== 検算 ========== */
  console.log("\n===== 検算 =====");
  let ng = 0;

  // (1) 承諾人数の合計 = acceptanceDate IS NOT NULL の求職者実人数（対象者・テスト除外後）
  const accCandidates = await prisma.jobEntry.findMany({
    where: { candidateId: { in: targetIds }, acceptanceDate: { not: null } },
    select: { candidateId: true },
    distinct: ["candidateId"],
  });
  const totalRow = rowsAll[rowsAll.length - 1];
  const okAccept = totalRow.accept === accCandidates.length;
  if (!okAccept) ng++;
  console.log(
    `(1) 承諾人数 集計=${totalRow.accept} / 独立クエリ(acceptanceDate IS NOT NULL の実人数)=${accCandidates.length} → ${okAccept ? "一致" : "不一致"}`,
  );

  // (2) 各段階が単調減少しているか（全行）
  const violations = [...rowsAll, ...rowsGender, ...rowsExclHaken].filter(
    (r) =>
      r.entry > r.interviewed || r.interview > r.entry || r.offer > r.interview || r.accept > r.offer,
  );
  if (violations.length > 0) ng++;
  console.log(
    `(2) 単調減少（後段<=前段）: ${violations.length === 0 ? "全行OK" : `違反 ${violations.length}行 → ${violations.map((v) => `${v.label}${v.gender ?? ""}`).join(", ")}`}`,
  );

  // (3) 前回スクリプト（面談2109人・決定119人）との整合
  //     承諾は判定基準が異なる: 前回は「承諾後に辞退・選考終了」を決定から除外していた。
  const endedDetails = ["選考落ち", "本人辞退", "本人辞退_他社決", "本人辞退_自社他", "クローズ", "求人クローズ"];
  const accExclEnded = await prisma.jobEntry.findMany({
    where: {
      candidateId: { in: targetIds },
      acceptanceDate: { not: null },
      OR: [{ entryFlagDetail: null }, { entryFlagDetail: { notIn: endedDetails } }],
    },
    select: { candidateId: true },
    distinct: ["candidateId"],
  });
  console.log(
    `(3) 前回比較: 面談実施=${totalRow.interviewed}（前回2109）/ ` +
      `承諾=${totalRow.accept}（前回の決定119は承諾後辞退を除外した数。` +
      `本スクリプトで同条件にすると ${accExclEnded.length}）`,
  );
  const okPrev = totalRow.interviewed === 2109 && accExclEnded.length === 119;
  if (!okPrev) {
    console.log(
      `    ※ 前回値と差異あり（面談 ${totalRow.interviewed} vs 2109 / 同条件承諾 ${accExclEnded.length} vs 119）。` +
        `期間末が実行日のため、実行日が変わると面談数は増減しうる。`,
    );
  }

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
