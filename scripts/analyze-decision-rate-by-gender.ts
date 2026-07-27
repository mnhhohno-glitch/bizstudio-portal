/**
 * CA別・性別別「面談実施 → 決定（承諾）」率の集計スクリプト（単発・読み取り専用）
 *
 * 実行: npx tsx scripts/analyze-decision-rate-by-gender.ts
 * 出力: scripts/output/decision-rate-by-gender.csv（UTF-8 BOM 付き）＋ 標準出力
 *
 * ※ 本スクリプトは SELECT のみ。既存テーブル・カラム・API・UI には一切変更を加えない。
 *
 * ============================================================================
 * Step 1: スキーマ調査結果（prisma/schema.prisma ＋ 本番実データで裏取り済み）
 * ============================================================================
 *
 * 1) 性別カラム: **存在する** → `Candidate.gender`（schema.prisma L455 / candidates.gender）
 *    - スキーマのコメントは "male" | "female" | "other"。本番実データも同表記で、
 *      female 2332 / male 1779 / null 102 / other 9 件（「男」「女」の和名表記は無し）。
 *    - 注意: 同名の `Employee.gender` は "男"|"女" 表記だが、これは自社社員であり求職者ではない。
 *    - 本スクリプトの表示変換: male→男性 / female→女性 / other・null→不明。
 *
 * 2) 面談実施の判定: `InterviewRecord`（interview_records）
 *    - 実施日 = `interviewDate`、状態 = `status`（実データの語彙は "complete" と "draft" の2値のみ）。
 *    - **status="draft" は集計から除外する。** 日程調整AIエージェントが仮予約時に作る
 *      プレースホルダ（interviewCount=null / isLatest=false / status="draft"）が含まれ、
 *      これは「実施済みの面談」ではないため（lib/schedule-agent/post-reserve.ts の設計に対応）。
 *    - `interviewDate` には未来日（実行日より後の予定）も入っているが、集計期間の上限で自然に落ちる。
 *
 * 3) 決定（承諾・入社）の判定: `JobEntry`（job_entries）の `acceptanceDate`
 *    - **`acceptanceDate IS NOT NULL` を決定の判定に使う。** 実データでの裏取り結果:
 *        acceptance_date あり            : 167 件
 *        内訳 entry_flag="入社済"        : 151 件（うち join_date あり 147）
 *             entry_flag="内定"/detail="承諾": 10 件
 *             entry_flag="内定"/detail=本人辞退_自社他: 1 件、本人辞退_他社決: 5 件
 *    - UI 上の承諾トリガ（EntryBoard.tsx: entryFlag="内定" && entryFlagDetail="承諾"）だけでは
 *      **10 件しか拾えず**、実績の大半を占める「入社済」151 件を取りこぼす。よって採用しない。
 *    - 承諾後に辞退した 6 件（本人辞退_他社決 / 本人辞退_自社他）は既定で決定から除外する
 *      （下の EXCLUDE_ENDED_FROM_DECISION で切り替え可能。除外時の決定は 161 件）。
 *
 * 4) 担当CA: `Candidate.employeeId` → `Employee.name`（candidates.employee_id）
 *    - このカラムは「現在の担当CA」を保持する単一の値であり、担当変更の履歴は持たない。
 *      したがって期間中に担当が変わっていた場合は **自動的に最新の担当CAで集計される**（仕様どおり）。
 *    - 未設定の求職者は 4222 人中 137 人。CA名を "(未割当)" として集計に含める（黙って落とさない）。
 *
 * 5) 決定先企業名: `JobEntry.companyName`（job_entries.company_name）→ 派遣判定に使用。
 *
 * ============================================================================
 * 集計定義
 * ============================================================================
 * 分母 = 期間内に status="complete" の面談を1回以上実施した求職者の実人数（重複排除）。
 * 分子 = その分母に含まれる求職者のうち、決定（acceptanceDate あり）に至った人数。
 *        - 決定側には期間フィルタを掛けない（期間内に面談した人が期間後に決定する事があるため）。
 *        - 1人が複数の決定を持つ場合は、最も古い acceptanceDate の1件を代表として扱う
 *          （人数ベースの指標のため、1人=1決定に正規化する）。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { config as loadEnv } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// 単体実行のため .env から DATABASE_URL を読む（src/lib/prisma.ts と同じ接続方式・アダプタを使う）。
loadEnv();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/* ========== 設定（ここを書き換えれば期間・判定を変更できる） ========== */

// 集計期間。既定は 2024-11-01 〜 実行日。
// 2024-11 より前は特定CAのみの実績となり、CA間の比較が成立しないため既定の開始日としている。
const START_DATE = new Date("2024-11-01T00:00:00+09:00");
const END_DATE = new Date(); // 実行日時

// 派遣判定キーワード（決定先企業名に部分一致で判定）。後から追加可能。
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

// 承諾後に辞退・選考終了となった決定を分子から除外するか（既定 true）。
// 対象の entryFlagDetail は下記。false にすると acceptanceDate があるもの全件を決定として数える。
const EXCLUDE_ENDED_FROM_DECISION = true;
const ENDED_DETAILS = [
  "選考落ち",
  "本人辞退",
  "本人辞退_他社決",
  "本人辞退_自社他",
  "クローズ",
  "求人クローズ",
];

// テスト・ダミー求職者の判別（実データで確認したパターン）。
// 5999xxx 番台はテスト用に払い出された番号帯、および氏名に テスト/test/ダミー を含むもの。
const TEST_NUMBER_PREFIX = "5999";
const TEST_NAME_PATTERN = /テスト|ダミー|test/i;
function isTestCandidate(c: { candidateNumber: string; name: string }): boolean {
  return c.candidateNumber.startsWith(TEST_NUMBER_PREFIX) || TEST_NAME_PATTERN.test(c.name);
}

const OUT_DIR = path.join("scripts", "output");
const OUT_FILE = path.join(OUT_DIR, "decision-rate-by-gender.csv");

/* ========== ヘルパー ========== */

const GENDER_LABELS = ["男性", "女性", "不明"] as const;
type GenderLabel = (typeof GENDER_LABELS)[number];

function toGenderLabel(gender: string | null): GenderLabel {
  if (gender === "male") return "男性";
  if (gender === "female") return "女性";
  return "不明"; // "other" / null / 想定外値
}

function isHaken(companyName: string | null): boolean {
  if (!companyName) return false;
  return HAKEN_KEYWORDS.some((kw) => companyName.includes(kw));
}

/** 決定率。分母0のときは空文字（0%と誤読させないため）。 */
function rate(numerator: number, denominator: number): string {
  if (denominator === 0) return "";
  return (numerator / denominator).toFixed(3);
}

/** CSV 1セルのエスケープ（カンマ・引用符・改行を含む場合のみ引用）。 */
function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type Row = {
  ca: string;
  gender: GenderLabel;
  interviewed: number;
  decided: number;
  hakenDecided: number;
};

function emptyRow(ca: string, gender: GenderLabel): Row {
  return { ca, gender, interviewed: 0, decided: 0, hakenDecided: 0 };
}

/* ========== 本体 ========== */

async function main() {
  console.log(
    `集計期間: ${START_DATE.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })} 〜 ` +
      `${END_DATE.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })}（JST）`,
  );

  // ---- 分母: 期間内に実施済み(complete)の面談を持つ求職者を重複排除で取得 ----
  const interviews = await prisma.interviewRecord.findMany({
    where: {
      status: "complete",
      interviewDate: { gte: START_DATE, lte: END_DATE },
    },
    select: { candidateId: true },
  });
  const draftCount = await prisma.interviewRecord.count({
    where: { status: "draft", interviewDate: { gte: START_DATE, lte: END_DATE } },
  });

  // 対象者ID未設定は分母・分子とも除外（スキーマ上は必須だが防御的に弾く）。
  const interviewedIds = new Set(interviews.map((i) => i.candidateId).filter(Boolean));
  console.log(
    `面談レコード: ${interviews.length}件(complete) / 対象求職者 ${interviewedIds.size}人` +
      `  ※draft ${draftCount}件は実施済みではないため除外`,
  );

  if (interviewedIds.size === 0) {
    console.log("対象となる面談がありません。処理を終了します。");
    return;
  }

  // ---- 求職者の属性（性別・担当CA）----
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

  // ---- 分子: 決定（acceptanceDate あり）。1人1件（最も古い承諾）に正規化 ----
  const targetIds = targets.map((c) => c.id);
  const acceptedEntries = await prisma.jobEntry.findMany({
    where: {
      candidateId: { in: targetIds },
      acceptanceDate: { not: null },
      // ★罠: 決定の大半を占める entryFlag="入社済" は entryFlagDetail が NULL。
      //   SQL の `NOT IN` は NULL との比較が不定になり、素の notIn だけだと入社済が全件消える
      //   （実測: 122人 → 8人に激減した）。NULL を明示的に許可すること。
      ...(EXCLUDE_ENDED_FROM_DECISION
        ? { OR: [{ entryFlagDetail: null }, { entryFlagDetail: { notIn: ENDED_DETAILS } }] }
        : {}),
    },
    select: { candidateId: true, companyName: true, acceptanceDate: true },
    orderBy: { acceptanceDate: "asc" },
  });

  // 最も古い承諾を代表として1人1件に畳む（orderBy asc なので先勝ち）。
  const decisionByCandidate = new Map<string, { companyName: string | null }>();
  for (const e of acceptedEntries) {
    if (!decisionByCandidate.has(e.candidateId)) {
      decisionByCandidate.set(e.candidateId, { companyName: e.companyName });
    }
  }
  console.log(
    `決定(承諾): ${decisionByCandidate.size}人` +
      (EXCLUDE_ENDED_FROM_DECISION ? "（承諾後に辞退・選考終了となった分は除外）" : "（辞退分も含む）"),
  );

  // ---- 集計 ----
  const rows = new Map<string, Row>();
  const key = (ca: string, g: GenderLabel) => `${ca} ${g}`;
  const caNames = new Set<string>();

  for (const c of targets) {
    const ca = c.employee?.name ?? "(未割当)";
    const g = toGenderLabel(c.gender);
    caNames.add(ca);
    const k = key(ca, g);
    const row = rows.get(k) ?? emptyRow(ca, g);
    row.interviewed += 1;
    const decision = decisionByCandidate.get(c.id);
    if (decision) {
      row.decided += 1;
      if (isHaken(decision.companyName)) row.hakenDecided += 1;
    }
    rows.set(k, row);
  }

  // CA × 性別 の全組み合わせを出力（該当0件でも行を作る）
  const sortedCas = [...caNames].sort((a, b) => a.localeCompare(b, "ja"));
  const outRows: Row[] = [];
  for (const ca of sortedCas) {
    for (const g of GENDER_LABELS) {
      outRows.push(rows.get(key(ca, g)) ?? emptyRow(ca, g));
    }
  }

  // 全社合計（性別ごと＋全体）
  const totalRows: Row[] = [];
  for (const g of GENDER_LABELS) {
    const t = emptyRow("全社合計", g);
    for (const r of outRows) {
      if (r.gender !== g) continue;
      t.interviewed += r.interviewed;
      t.decided += r.decided;
      t.hakenDecided += r.hakenDecided;
    }
    totalRows.push(t);
  }
  const grand = emptyRow("全社合計", "不明");
  for (const r of outRows) {
    grand.interviewed += r.interviewed;
    grand.decided += r.decided;
    grand.hakenDecided += r.hakenDecided;
  }

  // ---- 出力 ----
  const HEADERS = [
    "CA",
    "性別",
    "面談実施人数",
    "決定人数",
    "決定率",
    "派遣決定人数",
    "派遣除く決定人数",
    "派遣除く決定率",
  ];
  const toCells = (r: Row, caLabel = r.ca, genderLabel: string = r.gender) => {
    const exHaken = r.decided - r.hakenDecided;
    return [
      caLabel,
      genderLabel,
      r.interviewed,
      r.decided,
      rate(r.decided, r.interviewed),
      r.hakenDecided,
      exHaken,
      rate(exHaken, r.interviewed),
    ];
  };

  const lines: string[] = [HEADERS.map(csvCell).join(",")];
  for (const r of outRows) lines.push(toCells(r).map(csvCell).join(","));
  for (const t of totalRows) lines.push(toCells(t).map(csvCell).join(","));
  lines.push(toCells(grand, "全社合計", "全体").map(csvCell).join(","));

  mkdirSync(OUT_DIR, { recursive: true });
  // Excel で開くため UTF-8 BOM を付与し、改行は CRLF にする。
  writeFileSync(OUT_FILE, "﻿" + lines.join("\r\n") + "\r\n", "utf8");
  console.log(`\nCSV を出力しました: ${OUT_FILE}`);

  // ---- 標準出力へ整形表示 ----
  const disp = [
    ...outRows.map((r) => toCells(r)),
    ...totalRows.map((t) => toCells(t)),
    toCells(grand, "全社合計", "全体"),
  ];
  const table = [HEADERS, ...disp.map((cells) => cells.map(String))];
  // 各列幅を全角=2桁換算で算出して揃える
  const width = (s: string) => [...s].reduce((n, ch) => n + (/[\x00-\xff]/.test(ch) ? 1 : 2), 0);
  const colWidths = HEADERS.map((_, i) => Math.max(...table.map((row) => width(row[i]))));
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - width(s)));
  console.log();
  table.forEach((row, idx) => {
    console.log(row.map((cell, i) => pad(cell, colWidths[i])).join("  "));
    if (idx === 0) console.log(colWidths.map((w) => "-".repeat(w)).join("  "));
  });
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
