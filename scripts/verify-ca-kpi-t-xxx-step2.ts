/**
 * T-XXX step2: /api/ai/ca-kpi の集計（computeCaKpi）が実績表の正本（computeWeeklyMatrix・kpi.ts・computeInterviewRankBreakdown）と
 * 一致することの検証。読み取りのみ（接続を default_transaction_read_only=on にする）・AI に送らない・書き込まない。
 *
 * 比べる項目（全員 + CA職種の在籍者ごと、month の区切り 1 本と week の区切りそれぞれ）:
 *   面談 total/first/existing、紹介 records/candidates、エントリー records/candidates、
 *   書類通過・内定・承諾の records/candidates、企業面接の人数、面談ランク分布（合計＝初回面談数）。
 *
 * 実行:
 *   本番（railway ssh 経由・コンテナ上）:  npx tsx scripts/verify-ca-kpi-t-xxx-step2.ts --from 2026-08-01 --to 2026-08-31 --expect-2026-08
 *   ローカル検証DB:                        DATABASE_URL=... npx tsx scripts/verify-ca-kpi-t-xxx-step2.ts --from 2026-08-01 --to 2026-08-31
 * --expect-2026-08 を付けると、全員・2026-08 の値が step1 報告書の数字（面談185・初回82・エントリー48人/229件・書類通過26・内定10・承諾9人/10件）
 * と一致することも確かめる。
 * 出力は集計値のみ（求職者の個人情報は出さない）。不一致があれば exit 1。
 */

// @/lib/prisma を読み込む前に、接続を読み取り専用にする
{
  const u = new URL(process.env.DATABASE_URL!);
  u.searchParams.set("options", "-c default_transaction_read_only=on");
  process.env.DATABASE_URL = u.toString();
}

import { prisma } from "@/lib/prisma";
import { computeWeeklyMatrix, computeInterviewRankBreakdown } from "@/lib/performance/weeklyMatrix";
import { countCompanyInterviewCandidates } from "@/lib/aiRead/kpi";
import { jstDateStart, jstDateEnd } from "@/lib/dailyReport/jstDate";
import { buildCaKpiBuckets, CA_KPI_GROUPS } from "@/lib/aiRead/caKpiParams";
import { computeCaKpi, metricsFor, CA_KPI_ALL, type CaKpiMetrics } from "@/lib/aiRead/caKpi";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}
const FROM = arg("--from") ?? "2026-08-01";
const TO = arg("--to") ?? "2026-08-31";
const EXPECT_AUG = process.argv.includes("--expect-2026-08");

let failures = 0;
function check(label: string, actual: number | null | undefined, expected: number | null | undefined) {
  const ok = (actual ?? null) === (expected ?? null);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "NG  "} ${label}: ca-kpi=${actual ?? "null"} / 正本=${expected ?? "null"}`);
}

async function compareRange(
  label: string,
  m: CaKpiMetrics,
  scope: { employeeId: string; allCas: boolean },
  from: string,
  to: string,
) {
  const range = { from: jstDateStart(from), to: jstDateEnd(to) };
  const [mx, ci, rk] = await Promise.all([
    computeWeeklyMatrix({ employeeId: scope.employeeId, userId: "__nonexistent__", ...range, allCas: scope.allCas }),
    countCompanyInterviewCandidates({ employeeId: scope.employeeId, ...range, allCas: scope.allCas }),
    computeInterviewRankBreakdown({ employeeId: scope.employeeId, ...range, allCas: scope.allCas }),
  ]);
  check(`${label} 面談 total`, m.interview?.total, mx.interview.total);
  check(`${label} 面談 first`, m.interview?.first, mx.interview.first);
  check(`${label} 面談 existing`, m.interview?.existing, mx.interview.second + mx.interview.thirdPlus);
  check(`${label} 紹介 records`, m.proposal?.records, mx.proposal.total.recs);
  check(`${label} 紹介 candidates`, m.proposal?.candidates, mx.proposal.total.uniq);
  check(`${label} エントリー records`, m.entry?.records, mx.entry.total.recs);
  check(`${label} エントリー candidates`, m.entry?.candidates, mx.entry.total.uniq);
  check(`${label} 書類通過 records`, m.selection?.documentPass.records, mx.selection.documentPassRecs);
  check(`${label} 書類通過 candidates`, m.selection?.documentPass.candidates, mx.selection.documentPass);
  check(`${label} 内定 records`, m.selection?.offer.records, mx.selection.offerRecs);
  check(`${label} 内定 candidates`, m.selection?.offer.candidates, mx.selection.offer);
  check(`${label} 承諾 records`, m.selection?.acceptance.records, mx.selection.acceptanceRecs);
  check(`${label} 承諾 candidates`, m.selection?.acceptance.candidates, mx.selection.acceptance);
  check(`${label} 企業面接 candidates`, m.selection?.companyInterview.candidates, ci);
  const rankSum = m.interviewRank ? Object.values(m.interviewRank).reduce((s, v) => s + v, 0) : null;
  check(`${label} ランク分布の合計=初回`, rankSum, mx.interview.first);
  for (const [k, v] of Object.entries(rk)) {
    const key = k === "未評価" ? "unrated" : k;
    check(`${label} ランク ${key}`, (m.interviewRank as Record<string, number> | undefined)?.[key], v);
  }
}

async function main() {
  const cas = await prisma.employee.findMany({
    where: { jobCategory: "CA", status: "active" },
    select: { id: true, employeeNumber: true },
    orderBy: { employeeNumber: "asc" },
  });
  console.log(`期間 ${FROM}〜${TO} / CA ${cas.length} 名 / 読み取り専用接続`);

  const scopes = [
    { key: CA_KPI_ALL, label: "全員", employeeId: "__nonexistent__", allCas: true },
    ...cas.map((c) => ({ key: c.id, label: `CA ${c.employeeNumber}`, employeeId: c.id, allCas: false })),
  ];

  // 1) month 区切り（期間全体を 1 本の区切りにするため、from/to を同じ月に限定しない場合は week/day で確認する）
  const monthBuckets = buildCaKpiBuckets(FROM, TO, "month");
  const monthRes = await computeCaKpi({ buckets: monthBuckets, groups: CA_KPI_GROUPS, scope: { employeeId: null, userId: null } });
  for (const b of monthBuckets) {
    for (const s of scopes) {
      await compareRange(`[month ${b.key}] ${s.label}`, metricsFor(monthRes, s.key, b.key, CA_KPI_GROUPS), s, b.from, b.to);
    }
  }

  // 2) week 区切り（境界の確認）
  const weekBuckets = buildCaKpiBuckets(FROM, TO, "week");
  const weekRes = await computeCaKpi({ buckets: weekBuckets, groups: CA_KPI_GROUPS, scope: { employeeId: null, userId: null } });
  for (const b of weekBuckets) {
    for (const s of scopes) {
      await compareRange(`[week ${b.from}〜${b.to}] ${s.label}`, metricsFor(weekRes, s.key, b.key, CA_KPI_GROUPS), s, b.from, b.to);
    }
  }

  // 3) caId 指定（scope.employeeId あり）でも同じ値になること（先頭の CA のみ）
  if (cas.length) {
    const one = cas[0];
    const res1 = await computeCaKpi({ buckets: monthBuckets, groups: CA_KPI_GROUPS, scope: { employeeId: one.id, userId: null } });
    for (const b of monthBuckets) {
      const a = metricsFor(res1, one.id, b.key, CA_KPI_GROUPS);
      const bAll = metricsFor(monthRes, one.id, b.key, CA_KPI_GROUPS);
      check(`[caId=${one.employeeNumber} ${b.key}] 面談 total（単独/全員クエリ）`, a.interview?.total, bAll.interview?.total);
      check(`[caId=${one.employeeNumber} ${b.key}] エントリー records（単独/全員クエリ）`, a.entry?.records, bAll.entry?.records);
      check(`[caId=${one.employeeNumber} ${b.key}] 紹介 records（単独/全員クエリ）`, a.proposal?.records, bAll.proposal?.records);
    }
  }

  // 4) step1 報告書の 2026-08 の数字
  if (EXPECT_AUG) {
    const m = metricsFor(monthRes, CA_KPI_ALL, "2026-08", CA_KPI_GROUPS);
    check("[step1] 2026-08 全員 面談", m.interview?.total, 185);
    check("[step1] 2026-08 全員 初回面談", m.interview?.first, 82);
    check("[step1] 2026-08 全員 エントリー人数", m.entry?.candidates, 48);
    check("[step1] 2026-08 全員 エントリー件数", m.entry?.records, 229);
    check("[step1] 2026-08 全員 書類通過（人数）", m.selection?.documentPass.candidates, 26);
    check("[step1] 2026-08 全員 内定（人数）", m.selection?.offer.candidates, 10);
    check("[step1] 2026-08 全員 承諾（人数）", m.selection?.acceptance.candidates, 9);
    check("[step1] 2026-08 全員 承諾（件数）", m.selection?.acceptance.records, 10);
  }

  console.log(failures === 0 ? "\nPASS: すべて一致" : `\nFAIL: ${failures} 件不一致`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
