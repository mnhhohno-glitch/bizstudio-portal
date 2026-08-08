/**
 * 期間別・CA別「提案あり率」の集計（単発・読み取り専用）
 *
 * 実行: npx tsx scripts/analyze-proposal-rate-by-period.ts
 * 出力: scripts/output/proposal-rate-by-period.csv（UTF-8 BOM 付き）＋ 標準出力
 *
 * ※ SELECT のみ。既存テーブル・カラム・API・UI・既存スクリプトには一切変更を加えない。
 *
 * ============================================================================
 * 目的
 * ============================================================================
 * 前回集計（analyze-proposal-to-entry.ts / 2024-11-01以降・全期間）で安藤CAの提案あり率が
 * 0.493 と突出して低かった。これが「今も続いている状態」なのか「稼働初期の未着手を
 * 引きずっているだけ」なのかを、期間を区切って判別する。
 *
 * ============================================================================
 * ★ 重要: 提案日の判定に createdAt を使ってはいけない（実データで確認）
 * ============================================================================
 * JobEntry.createdAt は存在するが、**一括データ移行のタイムスタンプであり実際の提案日ではない**。
 *   created_at の年月分布: 2026-03=19 / **2026-04=27,714** / 2026-05=181 / 2026-06=302 / 2026-07=212
 *   （全 28,428 件中 97.5% が 2026-04 に集中。最古でも 2026-03-24。entry_date との平均乖離 323.6 日）
 * これで期間フィルタを掛けると recent3m（2026-05-01以降）で移行済みの 27,714 件が全て消え、
 * 提案件数が実態と懸け離れる。したがって createdAt は使用しない。
 *
 * 代わりに **JobEntry.introducedAt（紹介日・NOT NULL）** を提案日として使用する。
 *   introduced_at は 2023-06 〜 2026-07 に自然分布し（月あたり数百〜1,800件）、業務実態と整合する。
 *   意味的にも「求人を紹介した日」＝提案日そのもの。
 *
 * ============================================================================
 * 定義（analyze-proposal-to-entry.ts を踏襲。変更点は下記3点）
 * ============================================================================
 * - 分母コホート: 各期間の面談日レンジ内に status="complete" の面談を1件以上持つ求職者の実人数。
 *   draft（日程調整AIの仮予約プレースホルダ）除外・テスト求職者除外。
 * - 担当CA: Candidate.employeeId → Employee.name（現在値）。
 * - 「提案」= JobEntry レコードの存在。「エントリー到達」= フラグランク＋日付 OR 判定（前回と同一）。
 *
 * 【変更1】複数期間（PERIODS）を一度に集計する。
 * 【変更2】面談締め日 = 実行日の CUTOFF_DAYS(=30) 日前。面談直後で「これから提案する予定の0件」を
 *          分母に含めると提案あり率が実態より低く出るため、各期間の面談日 to を締め日で揃える。
 * 【変更3】JobEntry も「その期間の開始日以降に紹介されたもの」に限定する（introducedAt >= from）。
 *          上限は設けない（締め日以前に面談した人へ、締め日後に提案が入るのは正常なため）。
 *
 * ============================================================================
 * ★ 解釈上の注意: 2026-05 以降は「求人紹介」段階のレコードがほぼ作られていない
 * ============================================================================
 * entryFlag="求人紹介" の件数（introducedAt ベース）:
 *   2025-05〜2026-04 : 14,343 件中 11,887 件（82.9%）
 *   2026-05-01 以降  :    650 件中      1 件（0.2%）… 最終 2026-05-18
 * つまり直近は JobEntry が最初から書類選考/面接/エントリー段階で作られており、
 * 「提案したが応募に至らなかった」行がデータ上ほぼ存在しない。
 * このため recent3m の「提案あり率」「提案あり→エントリー率(=1.000になる)」は
 * all / recent15m と**同じ意味では比較できない**。下の PROPOSAL_STAGE_MIN_SHARE による
 * 自動診断で該当期間に警告を出す。
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

/* ========== 設定 ========== */

// 面談締め日: 実行日の CUTOFF_DAYS 日前。面談直後の「まだ提案前」を分母から外すため。
const CUTOFF_DAYS = 30;

// 集計期間（面談日の開始日）。後から追加・変更可能。
const PERIODS: { id: string; from: Date; note: string }[] = [
  { id: "all", from: new Date("2024-11-01T00:00:00+09:00"), note: "前回集計との比較用" },
  { id: "recent15m", from: new Date("2025-05-01T00:00:00+09:00"), note: "立ち上がり期を除いた現在の実力" },
  { id: "recent3m", from: new Date("2026-05-01T00:00:00+09:00"), note: "直近の動きのみ" },
];

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
const OUT_FILE = "proposal-rate-by-period.csv";

// 前回スクリプト（analyze-proposal-to-entry.ts・締め日なし/JobEntry期間フィルタなし）の値。検算の比較対象。
const PREV = {
  interviewed: { "大野 将幸": 546, "安藤 嘉富": 898, "岡田 愛子": 547, "南條 雄三": 89 } as Record<string, number>,
  interviewedTotal: 2109,
  proposalRate: { "大野 将幸": 0.656, "安藤 嘉富": 0.493, "岡田 愛子": 0.715 } as Record<string, number>,
};

// 期間横断で並べる主要CA
const FOCUS_CAS = ["大野 将幸", "安藤 嘉富", "岡田 愛子"];

// 期間内の JobEntry に占める entryFlag="求人紹介" の割合がこれを下回ったら、
// 「提案したが応募に至らなかった」行が記録されていない＝提案あり率が他期間と比較不能、と警告する。
const PROPOSAL_STAGE_MIN_SHARE = 0.2;

/* ========== ヘルパー ========== */

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

function ymd(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
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

/** JobEntry 1件が「エントリー以上に到達したことがあるか」。既存スクリプトと同一判定。 */
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

type Agg = {
  ca: string;
  interviewed: number;
  withProposal: number;
  proposalTotal: number;
  proposalCounts: number[];
  entryReached: number;
};

function emptyAgg(ca: string): Agg {
  return { ca, interviewed: 0, withProposal: 0, proposalTotal: 0, proposalCounts: [], entryReached: 0 };
}

const HEADERS = [
  "期間ID",
  "面談日from",
  "面談日to",
  "CA",
  "面談実施人数",
  "提案あり人数",
  "提案あり率",
  "提案件数合計",
  "提案数中央値",
  "エントリー到達人数",
  "提案あり→エントリー率",
];

function aggCells(periodId: string, from: string, to: string, a: Agg): (string | number)[] {
  return [
    periodId,
    from,
    to,
    a.ca,
    a.interviewed,
    a.withProposal,
    rate(a.withProposal, a.interviewed),
    a.proposalTotal,
    median(a.proposalCounts),
    a.entryReached,
    rate(a.entryReached, a.withProposal),
  ];
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

/* ========== 期間ごとの集計 ========== */

type PeriodResult = {
  id: string;
  from: Date;
  to: Date;
  aggs: Agg[]; // CA別（CA名昇順）
  total: Agg;
  introFlagShare: number; // 期間内 JobEntry に占める entryFlag="求人紹介" の割合（比較可能性の診断用）
  entryCount: number;
};

async function aggregatePeriod(period: { id: string; from: Date }, cutoff: Date): Promise<PeriodResult> {
  // 分母コホート: 面談日が [from, cutoff] に入る complete 面談を持つ求職者
  const interviews = await prisma.interviewRecord.findMany({
    where: { status: "complete", interviewDate: { gte: period.from, lte: cutoff } },
    select: { candidateId: true },
  });
  const ids = [...new Set(interviews.map((i) => i.candidateId).filter(Boolean))];

  const candidates = ids.length
    ? await prisma.candidate.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          candidateNumber: true,
          name: true,
          employee: { select: { name: true } },
        },
      })
    : [];
  const targets = candidates.filter((c) => !isTestCandidate(c));
  const targetIds = targets.map((c) => c.id);

  // 【変更3】JobEntry も期間開始日以降に紹介されたものだけ（introducedAt を提案日として使用）。
  const entries = targetIds.length
    ? ((await prisma.jobEntry.findMany({
        where: { candidateId: { in: targetIds }, introducedAt: { gte: period.from } },
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
      })) as EntryRow[])
    : [];

  const per = new Map<string, { count: number; hasEntry: boolean }>();
  for (const id of targetIds) per.set(id, { count: 0, hasEntry: false });
  for (const e of entries) {
    const st = per.get(e.candidateId);
    if (!st) continue;
    st.count += 1;
    if (reachedEntry(e)) st.hasEntry = true;
  }

  const byCa = new Map<string, Agg>();
  for (const c of targets) {
    const ca = c.employee?.name ?? "(未割当)";
    const st = per.get(c.id) ?? { count: 0, hasEntry: false };
    const a = byCa.get(ca) ?? emptyAgg(ca);
    a.interviewed += 1;
    a.proposalTotal += st.count;
    if (st.count > 0) {
      a.withProposal += 1;
      a.proposalCounts.push(st.count);
    }
    if (st.hasEntry) a.entryReached += 1;
    byCa.set(ca, a);
  }

  const aggs = [...byCa.values()].sort((a, b) => a.ca.localeCompare(b.ca, "ja"));
  const total = emptyAgg("全社合計");
  for (const a of aggs) {
    total.interviewed += a.interviewed;
    total.withProposal += a.withProposal;
    total.proposalTotal += a.proposalTotal;
    total.entryReached += a.entryReached;
    total.proposalCounts.push(...a.proposalCounts);
  }

  // 比較可能性の診断: 期間内 JobEntry に「求人紹介」段階の行がどれだけ残っているか。
  const introFlagCount = entries.filter((e) => e.entryFlag === "求人紹介").length;
  const introFlagShare = entries.length === 0 ? 0 : introFlagCount / entries.length;

  return { id: period.id, from: period.from, to: cutoff, aggs, total, introFlagShare, entryCount: entries.length };
}

/* ========== 本体 ========== */

async function main() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - CUTOFF_DAYS * 24 * 60 * 60 * 1000);
  console.log(
    `実行日: ${ymd(now)} / 面談締め日(CUTOFF_DAYS=${CUTOFF_DAYS}): ${ymd(cutoff)}\n` +
      `提案日カラム: JobEntry.introducedAt（createdAt は一括移行値のため使用しない）`,
  );

  const results: PeriodResult[] = [];
  for (const p of PERIODS) {
    results.push(await aggregatePeriod(p, cutoff));
  }

  // ---- CSV ----
  const rows: (string | number)[][] = [];
  for (const r of results) {
    const from = ymd(r.from);
    const to = ymd(r.to);
    for (const a of r.aggs) rows.push(aggCells(r.id, from, to, a));
    rows.push(aggCells(r.id, from, to, r.total));
  }
  const lines = [HEADERS.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, OUT_FILE), "﻿" + lines.join("\r\n") + "\r\n", "utf8");
  console.log(`\nCSV を出力しました: ${OUT_DIR}/${OUT_FILE}`);

  // ---- 期間ごとの表 ----
  for (const r of results) {
    const note = PERIODS.find((p) => p.id === r.id)?.note ?? "";
    printTable(
      `期間 ${r.id}（面談日 ${ymd(r.from)} 〜 ${ymd(r.to)}）${note ? ` … ${note}` : ""}`,
      HEADERS.slice(3), // 期間・from・to は見出しに出しているので列からは省く
      [...r.aggs, r.total].map((a) => aggCells(r.id, "", "", a).slice(3)),
    );
  }

  // ---- 主要3CAの期間横断比較（提案あり率）----
  const cmpHeaders = ["CA", ...results.map((r) => r.id)];
  const cmpRows: (string | number)[][] = FOCUS_CAS.map((ca) => [
    ca,
    ...results.map((r) => {
      const a = r.aggs.find((x) => x.ca === ca);
      return a ? `${rate(a.withProposal, a.interviewed)} (${a.withProposal}/${a.interviewed})` : "-";
    }),
  ]);
  cmpRows.push([
    "全社合計",
    ...results.map((r) => `${rate(r.total.withProposal, r.total.interviewed)} (${r.total.withProposal}/${r.total.interviewed})`),
  ]);
  printTable("主要3CA 提案あり率の期間横断比較", cmpHeaders, cmpRows);

  // ---- 比較可能性の診断 ----
  console.log("\n===== 期間の比較可能性の診断 =====");
  for (const r of results) {
    const pct = (r.introFlagShare * 100).toFixed(1);
    const warn = r.introFlagShare < PROPOSAL_STAGE_MIN_SHARE;
    console.log(
      `${r.id}: JobEntry ${r.entryCount}件中 entryFlag="求人紹介" は ${pct}%` +
        (warn
          ? `  ⚠ 閾値${PROPOSAL_STAGE_MIN_SHARE * 100}%未満。「提案したが応募に至らなかった」行が`
            + `ほぼ記録されていないため、この期間の提案あり率・提案あり→エントリー率は他期間と同じ意味では比較できない。`
          : "  → 比較可能"),
    );
  }

  /* ========== 検算 ========== */
  console.log("\n===== 検算 =====");
  let ng = 0;

  // (1) 期間 all と前回スクリプトの差分（完全一致はしない。差が変更2・3で説明できるか）
  const all = results.find((r) => r.id === "all")!;
  console.log("(1) 期間 all と前回スクリプトの比較（差は 変更2:締め日30日 と 変更3:JobEntry期間フィルタ に由来）");
  for (const ca of Object.keys(PREV.interviewed)) {
    const a = all.aggs.find((x) => x.ca === ca);
    const iv = a?.interviewed ?? 0;
    const pr = a ? Number(rate(a.withProposal, a.interviewed) || 0) : 0;
    const prevPr = PREV.proposalRate[ca];
    console.log(
      `    ${ca}: 面談 ${iv} (前回 ${PREV.interviewed[ca]}, 差 ${iv - PREV.interviewed[ca]})` +
        (prevPr !== undefined ? ` / 提案あり率 ${pr.toFixed(3)} (前回 ${prevPr}, 差 ${(pr - prevPr).toFixed(3)})` : ""),
    );
  }
  console.log(
    `    全社: 面談 ${all.total.interviewed} (前回 ${PREV.interviewedTotal}, 差 ${all.total.interviewed - PREV.interviewedTotal})`,
  );
  // 面談人数は締め日でのみ減るため「今回 <= 前回」が期待どおり。増えていたら説明不能。
  const ivIncreased = all.total.interviewed > PREV.interviewedTotal;
  if (ivIncreased) {
    ng++;
    console.log("    ※ 面談人数が前回より増加。締め日を入れた以上ありえないため要調査。");
  } else {
    console.log("    → 面談人数の減少は締め日30日で説明可能（増加していない）。");
  }

  // (2) 提案あり人数 <= 面談実施人数
  const allAggs = results.flatMap((r) => [...r.aggs, r.total]);
  const bad2 = allAggs.filter((a) => a.withProposal > a.interviewed);
  if (bad2.length > 0) ng++;
  console.log(
    `(2) 提案あり人数 <= 面談実施人数: ${bad2.length === 0 ? "全行OK" : `違反 ${bad2.length}行 → ${bad2.map((b) => b.ca).join(", ")}`}`,
  );

  // (3) エントリー到達人数 <= 提案あり人数
  const bad3 = allAggs.filter((a) => a.entryReached > a.withProposal);
  if (bad3.length > 0) ng++;
  console.log(
    `(3) エントリー到達人数 <= 提案あり人数: ${bad3.length === 0 ? "全行OK" : `違反 ${bad3.length}行 → ${bad3.map((b) => b.ca).join(", ")}`}`,
  );

  console.log(ng === 0 ? "\n検算: 問題なし" : `\n検算: ${ng}件の要調査あり（上記参照）`);
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
