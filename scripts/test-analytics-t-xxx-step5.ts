/**
 * T-XXX step5C: 分析ツールの組み立て関数を架空データ（scripts/seed-analytics-fixture-t-xxx-step5.ts）で検証する。
 * 読み取りのみ・AI を呼ばない。**ローカル DB 専用**（DATABASE_URL が localhost でないと止まる）。
 *
 *   DATABASE_URL=postgresql://postgres:t5@localhost:55432/t5 npx tsx scripts/test-analytics-t-xxx-step5.ts
 *
 * 確かめること（§D-C）:
 *   在籍CAのみ（退職済み 9004 は既定の対象外）／入社前期間（9002 の 5・6 月の行が無い）／初回面談の再設定 2 名（実施分の月に入る）／
 *   複数応募（人数 1・件数 3）／担当変更（今の担当で付く）／承諾後辞退（分けて数える・ALL の revenue は承諾後辞退を含む）／
 *   月またぎ（初回 5/31・応募 6/1）／選考中は inProgress（不合格に数えない）／少人数の伏せ（9003 は 3 名 → suppressed）／
 *   get_accept_revenue の CA別合計＝全体合計／company-kpi の invoiceRevenue と ALL.revenue が一致／入社日未登録の警告／応答に historySince があること。
 */
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL がローカルではありません。中止します");
  process.exit(1);
}

import { buildCaRoster } from "@/lib/aiRead/analytics/roster";
import { buildCohortFunnel } from "@/lib/aiRead/analytics/cohort";
import { buildSelectionConversion } from "@/lib/aiRead/analytics/conversion";
import { buildPipelineNow } from "@/lib/aiRead/analytics/pipeline";
import { buildAcceptRevenue } from "@/lib/aiRead/analytics/revenue";
import { buildForecastInputs } from "@/lib/aiRead/analytics/forecast";
import { buildSegmentBreakdown } from "@/lib/aiRead/analytics/segment";
import { buildSnapshotHistory } from "@/lib/aiRead/analytics/snapshot";
import { buildDataQuality } from "@/lib/aiRead/analytics/quality";
import { buildCompanyKpiResponse } from "@/lib/aiRead/companyKpiResponse";
import { savePipelineSnapshot } from "@/lib/pipeline-snapshot";
import { quantiles, monthsBetween } from "@/lib/aiRead/analytics/common";
import { prisma } from "@/lib/prisma";

type J = Record<string, unknown>;
let failures = 0;
let checks = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : `: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`}`);
}
function checkTrue(label: string, cond: boolean, detail = ""): void {
  checks++;
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
}
const rows = (b: J, key: string) => b[key] as J[];
const find = (rs: J[], ca: string, month: string | null) => rs.find((r) => r.ca === ca && (r.month ?? null) === month) as J | undefined;

async function main() {
  // 純粋関数
  check("[0] quantiles 標本4は null", quantiles([1, 2, 3, 4]), null);
  check("[0] quantiles 標本5", quantiles([1, 2, 3, 4, 5])?.median, 3);
  check("[0] monthsBetween", monthsBetween("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);

  // roster
  const roster = await buildCaRoster();
  const cas = roster.cas as J[];
  check("[1] roster CA 数（CA 職種のみ）", cas.length, 4);
  check("[1] 9004（退職・disabled）は既定の対象外", (cas.find((c) => c.employeeNumber === "9004") as J).inDefaultAggregation, false);
  check("[1] 9002 在籍開始月", ((cas.find((c) => c.employeeNumber === "9002") as J).tenure as J).fromMonth, "2026-07");
  checkTrue("[1] 入社日未登録の警告（9003）", (roster.warnings as string[]).some((w) => w.includes("9003")), String(roster.warnings));
  checkTrue("[1] historySince がある", "historySince" in roster && "entryStatus" in (roster.historySince as J));
  check("[1] 9001 の活動中人数", ((cas.find((c) => c.employeeNumber === "9001") as J).current as J).activeCandidates, 5 * 5 + 3 + 0 /* r1,r2,s1 ACTIVE; d1 ENDED; f1 BEFORE */);

  // cohort
  const cohort = await buildCohortFunnel({ cohortFrom: "2026-05", cohortTo: "2026-09" });
  const bm = rows(cohort, "byMonth");
  check("[2] 9002 の 5 月の行は無い（在籍前）", find(bm, "9002", "2026-05"), undefined);
  check("[2] 9002 の 6 月の行は無い（在籍前）", find(bm, "9002", "2026-06"), undefined);
  checkTrue("[2] 9002 の 7 月の行はある", !!find(bm, "9002", "2026-07"));
  check("[2] 9004（退職）は既定で出ない", bm.some((r) => r.ca === "9004"), false);
  check("[2] ALL 2026-05 人数（甲6＋乙2＋月またぎ1）", find(bm, "ALL", "2026-05")?.people, 9);
  check("[2] ALL 2026-06 人数（甲6＋乙2＋丁5＋再設定r1）", find(bm, "ALL", "2026-06")?.people, 14);
  check("[2] ALL 2026-07 人数（甲6＋乙5＋再設定r2＋承諾後辞退d1）", find(bm, "ALL", "2026-07")?.people, 13);
  check("[2] ALL 2026-08 人数（甲6＋乙5＋丙3＋担当なし1＋スカウト担当1＋担当変更1）", find(bm, "ALL", "2026-08")?.people, 17);
  check("[2] 9001 2026-05（甲6＋月またぎ1）", find(bm, "9001", "2026-05")?.people, 7);
  const a05 = find(bm, "9001", "2026-05") as J;
  check("[2] 9001 2026-05 提案（6 名。月またぎは提案なし）", (a05.reached as J).proposal, 6);
  check("[2] 9001 2026-05 エントリー人数（i=0,1,2,4 ＋ 月またぎ）", (a05.reached as J).entry, 5);
  check("[2] 9001 2026-05 承諾", (a05.reached as J).acceptance, 1);
  check("[2] 9001 2026-05 outcome", a05.outcome, { accepted: 1, observing: 5, ended: 1 });
  check("[2] 9003（3 名）は 8 月で伏せ", find(bm, "9003", "2026-08")?.suppressed, true);
  check("[2] 9003 の人数は null", find(bm, "9003", "2026-08")?.people, null);
  check("[2] 担当変更後の人は 9002 の 8 月に入る（今の担当）", find(bm, "9002", "2026-08")?.people, 6);
  check("[2] 9 月の 9001 承諾は 0（観測中）", (find(bm, "9001", "2026-09") as J).outcome, { accepted: 0, observing: 5, ended: 1 });
  const tot = rows(cohort, "total");
  check("[2] total 9002 は在籍月のみ（7〜9 月 = 5+5+6）", find(tot, "9002", null)?.people, 16);
  checkTrue("[2] 日数の分布（ALL 承諾）", ((find(tot, "ALL", null) as J).daysFromFirstInterview as J).acceptance != null);

  // selection conversion
  const conv = await buildSelectionConversion({ from: "2026-05", to: "2026-09" });
  const cm = rows(conv, "byMonth");
  const c06 = find(cm, "ALL", "2026-06") as J;
  // 6 月エントリー: 甲 i=0,1,2（3 件）＋ i=4（3 件）＋ 乙 2 件 ＋ 月またぎ 1 件 = 9 件
  check("[3] ALL 2026-06 件数", c06.records, 9);
  check("[3] ALL 2026-06 人数（複数応募は 1 人）", c06.people, 7);
  check("[3] 2026-06 outcome.inProgress（選考中を不合格にしない）", (c06.outcome as J).inProgress, 7);
  check("[3] 2026-06 outcome.rejected", (c06.outcome as J).rejected, 1);
  check("[3] 2026-06 outcome.accepted", (c06.outcome as J).accepted, 1);
  const c07 = find(cm, "ALL", "2026-07") as J;
  check("[3] 2026-07 承諾後辞退を分ける", (c07.outcome as J).acceptedThenDeclined, 1);
  check("[3] 9002 の 2026-06 の行は無い", find(cm, "9002", "2026-06"), undefined);

  // revenue
  const rev = await buildAcceptRevenue({ from: "2026-05", to: "2026-09" });
  const rm = rows(rev, "byMonth");
  const r08 = find(rm, "ALL", "2026-08") as J;
  // 8 月承諾: 7 月コホート i=0（800000+100000=900000）＋ 承諾後辞退 d1 700000
  check("[4] ALL 2026-08 承諾件数", r08.deals, 2);
  check("[4] ALL 2026-08 revenue（承諾後辞退を含む）", r08.revenue, 1600000);
  check("[4] ALL 2026-08 acceptedThenDeclined", r08.acceptedThenDeclined, { deals: 1, revenue: 700000, grossProfit: 680000 });
  check("[4] ALL 2026-08 net.revenue", (r08.net as J).revenue, 900000);
  check("[4] ALL 2026-08 grossProfit", r08.grossProfit, 900000 - 50000 - 30000 + 680000);
  const ck = await buildCompanyKpiResponse({ year: null, month: "2026-08" });
  check("[4] company-kpi 2026-08 invoiceRevenue = ALL.revenue", ((ck.body as J).month as J & { invoiceRevenue?: number }).invoiceRevenue, r08.revenue);
  check("[4] company-kpi 2026-08 grossProfit = ALL.grossProfit", ((ck.body as J).month as J & { grossProfit?: number }).grossProfit, r08.grossProfit);
  const rt = rows(rev, "total");
  const allTotal = find(rt, "ALL", null) as J;
  const caSum = rt.filter((r) => r.ca !== "ALL").reduce((s, r) => s + (r.revenue as number), 0);
  check("[4] 期間合計: CA別合計 = 全体合計（担当なし・CA以外の承諾は無いデータ）", caSum, allTotal.revenue);
  check("[4] 期間合計 deals（5 月〜8 月承諾 4 件＋辞退 1）", allTotal.deals, 5);

  // pipeline now
  const pipe = await buildPipelineNow({});
  const prow = rows(pipe, "rows");
  const pAll = prow.find((r) => r.ca === "ALL") as J;
  check("[5] 今後の面談予約（初回 2・継続 1）", pAll.upcomingInterviews, { first: 2, existing: 1, total: 3 });
  checkTrue("[5] 選考中の件数 > 0", ((pAll.inSelection as J).records as number) > 0);
  checkTrue("[5] NONE 行がある", prow.some((r) => r.ca === "NONE"));

  // snapshot: 2 回保存して重複しない
  const s1 = await savePipelineSnapshot({ execute: true });
  const s2 = await savePipelineSnapshot({ execute: true });
  check("[6] 1 回目は created", s1.created > 0 && s1.updated === 0, true);
  check("[6] 2 回目は updated のみ", s2.created === 0 && s2.updated === s1.created, true);
  const cnt = await prisma.caPipelineDailySnapshot.count();
  check("[6] 行数は 1 日分だけ", cnt, s1.rows);
  const hist = await buildSnapshotHistory({});
  // 既定の対象は ALL・NONE・在籍CA 3 名（退職済み 9004 と CA 以外の担当は返さない）
  check("[6] get_snapshot_history の行数", (hist.rows as J[]).length, 5);
  check("[6] runCount = 2", ((hist.rows as J[])[0] as J).runCount, 2);

  // forecast inputs
  const fc = await buildForecastInputs({});
  const fAll = (fc.scopes as J[]).find((s) => s.ca === "ALL") as J;
  checkTrue("[7] stageToAcceptance.entered がある", ((fAll.stageToAcceptance as J).entered as J).reached != null);
  checkTrue("[7] pipelineNow がある", fAll.pipelineNow != null);
  check("[7] acceptedThenDeclinedDeals", (fAll.revenue as J).acceptedThenDeclinedDeals, 1);

  // segment
  const seg = await buildSegmentBreakdown({ segment: "desiredJobType" });
  const sAll = (seg.scopes as J[]).find((s) => s.ca === "ALL") as J;
  const segs = sAll.segments as J[];
  checkTrue("[8] 営業・事務の区分がある", segs.some((s) => s.value === "営業") && segs.some((s) => s.value === "事務"));
  checkTrue("[8] 未記載がある（面談詳細の無い人）", segs.some((s) => s.value === "未記載"));
  const edu = await buildSegmentBreakdown({ segment: "educationLevel" });
  checkTrue("[8] 学歴の寄せ", ((edu.scopes as J[])[0].segments as J[]).some((s) => s.value === "短大・専門卒"));

  // quality
  const q = await buildDataQuality({});
  checkTrue("[9] 入力率がある", ((q.interviewDetailInputRates as J).fields as J[]).length > 10);
  check("[9] historySince.pipelineSnapshot は今日", (q.historySince as J).pipelineSnapshot, new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }));

  // 入力誤り
  let err = "";
  try { await buildCohortFunnel({ cohortFrom: "2026-13" }); } catch (e) { err = (e as Error).message; }
  checkTrue("[10] 月の形式誤りはエラー文", err.includes("YYYY-MM"), err);
  err = "";
  try { await buildCohortFunnel({ cohortFrom: "2024-01", cohortTo: "2026-09" }); } catch (e) { err = (e as Error).message; }
  checkTrue("[10] 期間超過はエラー文", err.includes("上限"), err);
  err = "";
  try { await buildCohortFunnel({ caId: "nobody" }); } catch (e) { err = (e as Error).message; }
  checkTrue("[10] caId 不在はエラー文", err.includes("見つかりません"), err);

  // 個人情報が無いこと（候補者番号・氏名が応答に含まれない）
  for (const [name, body] of [["roster", roster], ["cohort", cohort], ["conv", conv], ["rev", rev], ["pipe", pipe], ["fc", fc], ["seg", seg], ["q", q]] as const) {
    const s = JSON.stringify(body);
    checkTrue(`[11] ${name} に求職者番号・氏名が無い`, !/900000\d|架空 \d/.test(s));
  }

  console.log(`\n${checks - failures}/${checks} PASS${failures ? ` (${failures} FAIL)` : ""}`);
  process.exit(failures ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
