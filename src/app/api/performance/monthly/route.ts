// T-071 ②：当月実績タブ用 API。
// 当月1日起算の週別（月内クランプ・4〜6週）に実績表マトリクス（computeWeeklyMatrix）を集計し、
// 合計（当月通算ユニーク再集計）＋目標（週按分）＋達成率＋属性集計（当月初回面談者の円グラフ用）を返す。
// レスポンスは weekly API 互換（columns/total）＋ attributes。集計の数え方は変更せず流用（両ソース統合・MIN方式）。
//
// 週区切り：weeklyBusinessDays（月曜始まり・月内クランプ。W1=1日〜最初の日曜、以降 月〜日）。
// 目標：当月の PerformanceTarget を週へ営業日按分（initial面談・提案・エントリーのみ。書類通過以降は週按分せず null＝T-073方針）。
// 属性（円グラフ）：当月の初回面談（interview_count=1・辞退系除外・担当軸 candidate.employeeId）を母集団に
//   ランク（overall_rank）／性別（candidate.gender）／職種希望（interview_details.desired_job_types[0].large）／年齢層（birthday→AGE）。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { computeWeeklyMatrix, type WeeklyMatrix } from "@/lib/performance/weeklyMatrix";
import { weeklyBusinessDays, monthBusinessDays, allocateToWeeks, type WeekBucket } from "@/lib/performance/businessDays";
import { INTERVIEW_DECLINED_FLAGS } from "@/lib/dailyReport/constants";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DECLINED_SQL = INTERVIEW_DECLINED_FLAGS.map((f) => `'${f}'`).join(",");

type TKey = "interviewFirst" | "proposalUniq" | "entryUniq" | "documentPass" | "offer" | "acceptance";
const TKEYS: TKey[] = ["interviewFirst", "proposalUniq", "entryUniq", "documentPass", "offer", "acceptance"];
// 週按分する対象（書類通過以降は週按分しない＝T-073方針）。
const WEEK_ALLOCATED: Record<TKey, boolean> = {
  interviewFirst: true, proposalUniq: true, entryUniq: true, documentPass: false, offer: false, acceptance: false,
};
const TARGET_FIELD: Record<TKey, "interviewCount" | "introductionCount" | "entryCount" | "documentPassCount" | "offerCount" | "acceptanceCount"> = {
  interviewFirst: "interviewCount", proposalUniq: "introductionCount", entryUniq: "entryCount",
  documentPass: "documentPassCount", offer: "offerCount", acceptance: "acceptanceCount",
};

function actualOf(m: WeeklyMatrix, key: TKey): number {
  switch (key) {
    case "interviewFirst": return m.interview.first;
    case "proposalUniq": return m.proposal.total.uniq;
    case "entryUniq": return m.entry.total.uniq;
    case "documentPass": return m.selection.documentPass;
    case "offer": return m.selection.offer;
    case "acceptance": return m.selection.acceptance;
  }
}
function rate(num: number, den: number | null): number | null {
  return den == null || den <= 0 ? null : num / den;
}
function jstStart(dateStr: string): Date { return new Date(`${dateStr}T00:00:00+09:00`); }
function jstEnd(dateStr: string): Date { return new Date(`${dateStr}T23:59:59.999+09:00`); }
function mdLabel(dateStr: string): string { const [, m, d] = dateStr.split("-"); return `${parseInt(m)}/${parseInt(d)}`; }

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employeeId");
  const anchorDate = searchParams.get("anchorDate");
  if (!employeeId || !anchorDate || !DATE_RE.test(anchorDate)) {
    return NextResponse.json({ error: "employeeId と anchorDate(YYYY-MM-DD) が必要です" }, { status: 400 });
  }
  const yearMonth = anchorDate.slice(0, 7);

  const allCas = employeeId === "all";
  let resolvedEmployeeId = "__nonexistent__";
  let employeeName = "全員";
  let userId = "__nonexistent__";
  if (!allCas) {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true, userId: true } });
    if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });
    resolvedEmployeeId = employee.id;
    employeeName = employee.name;
    userId = employee.userId ?? "__nonexistent__";
  }

  // 当月1日起算の週（月内クランプ・4〜6週）。
  const buckets: WeekBucket[] = weeklyBusinessDays(yearMonth);
  const monthFirst = `${yearMonth}-01`;
  const monthLastBucket = buckets[buckets.length - 1];
  const monthFrom = jstStart(monthFirst);
  const monthTo = jstEnd(monthLastBucket.endDate);

  // 各週マトリクス＋TOTAL（当月通算再集計）＋属性を並列。
  const [columnMatrices, totalMatrix, attributes] = await Promise.all([
    Promise.all(buckets.map((b) => computeWeeklyMatrix({ employeeId: resolvedEmployeeId, userId, from: jstStart(b.startDate), to: jstEnd(b.endDate), allCas }))),
    computeWeeklyMatrix({ employeeId: resolvedEmployeeId, userId, from: monthFrom, to: monthTo, allCas }),
    computeMonthlyAttributes({ employeeId: resolvedEmployeeId, from: monthFrom, to: monthTo, allCas }),
  ]);

  // 目標（当月の PerformanceTarget。週按分は initial面談・提案・エントリーのみ）。
  const targetRow = allCas ? null : await prisma.performanceTarget.findUnique({
    where: { employeeId_yearMonth: { employeeId: resolvedEmployeeId, yearMonth } },
  });
  const targetExists = !!targetRow;
  const monthBiz = monthBusinessDays(yearMonth);

  const perColumnTargets: Record<TKey, (number | null)[]> = {} as Record<TKey, (number | null)[]>;
  const totalTargets: Record<TKey, number | null> = {} as Record<TKey, number | null>;
  for (const key of TKEYS) {
    const monthT = targetRow ? (targetRow[TARGET_FIELD[key]] as number) : null;
    totalTargets[key] = monthT;
    if (monthT == null || !WEEK_ALLOCATED[key]) {
      perColumnTargets[key] = buckets.map(() => null); // 書類通過以降・目標なしは週按分しない
    } else {
      perColumnTargets[key] = allocateToWeeks(monthT, buckets);
    }
  }
  void monthBiz; // （将来 day 粒度で使用。week 按分は allocateToWeeks が businessDays を内包）

  const columns = buckets.map((b, i) => {
    const targets: Record<TKey, number | null> = {} as Record<TKey, number | null>;
    for (const key of TKEYS) targets[key] = perColumnTargets[key][i];
    return {
      index: b.weekIndex,
      label: `${b.weekIndex + 1}W`,
      subLabel: `${mdLabel(b.startDate)}〜${mdLabel(b.endDate)}`,
      from: b.startDate,
      to: b.endDate,
      businessDays: b.businessDays,
      matrix: columnMatrices[i],
      targets,
    };
  });

  const achievement: Record<TKey, number | null> = {} as Record<TKey, number | null>;
  for (const key of TKEYS) achievement[key] = rate(actualOf(totalMatrix, key), totalTargets[key]);

  return NextResponse.json({
    employee: { id: allCas ? "all" : resolvedEmployeeId, name: employeeName },
    yearMonth,
    granularity: "week",
    targetExists,
    columns,
    total: { from: monthFirst, to: monthLastBucket.endDate, matrix: totalMatrix, targets: totalTargets, achievement },
    attributes,
  });
}

// 当月の初回面談（interview_count=1・辞退系除外・担当軸）を母集団に、4属性の分布を返す。
// 全 4 種とも母数＝初回面談数（rank と一致）。null は「未設定/未評価/不明」に寄せる。
async function computeMonthlyAttributes(params: { employeeId: string; from: Date; to: Date; allCas?: boolean }) {
  const { employeeId, from, to, allCas } = params;
  const F = from.toISOString().replace("T", " ").replace("Z", "");
  const T = to.toISOString().replace("T", " ").replace("Z", "");
  const empPred = allCas ? "TRUE" : `c.employee_id = '${employeeId}'`;
  const base = `
    FROM interview_records ir
    JOIN candidates c ON c.id = ir.candidate_id
    LEFT JOIN interview_details d ON d.interview_record_id = ir.id
    LEFT JOIN interview_ratings rt ON rt.interview_record_id = ir.id
    WHERE ${empPred}
      AND ir.interview_count = 1
      AND (ir.result_flag IS NULL OR ir.result_flag NOT IN (${DECLINED_SQL}))
      AND ir.interview_date >= TIMESTAMP '${F}' AND ir.interview_date <= TIMESTAMP '${T}'`;

  const [rankRows, genderRows, jobRows, ageRows, totalRows] = await Promise.all([
    prisma.$queryRawUnsafe<{ k: string; n: number }[]>(`SELECT COALESCE(NULLIF(rt.overall_rank,''),'未評価') k, COUNT(*)::int n ${base} GROUP BY 1`),
    prisma.$queryRawUnsafe<{ k: string; n: number }[]>(`SELECT COALESCE(c.gender,'未設定') k, COUNT(*)::int n ${base} GROUP BY 1`),
    prisma.$queryRawUnsafe<{ k: string; n: number }[]>(`SELECT COALESCE(d.desired_job_types->0->>'large','未設定') k, COUNT(*)::int n ${base} GROUP BY 1`),
    prisma.$queryRawUnsafe<{ k: string; n: number }[]>(`
      SELECT CASE
        WHEN age BETWEEN 20 AND 24 THEN '20代前半' WHEN age BETWEEN 25 AND 29 THEN '20代後半'
        WHEN age BETWEEN 30 AND 34 THEN '30代前半' WHEN age BETWEEN 35 AND 39 THEN '30代後半'
        WHEN age BETWEEN 40 AND 44 THEN '40代前半' WHEN age >= 45 THEN '45歳以上' ELSE '不明' END k,
        COUNT(*)::int n
      FROM (SELECT EXTRACT(YEAR FROM AGE(c.birthday))::int age ${base}) x GROUP BY 1`),
    prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int n ${base}`),
  ]);
  const toMap = (rows: { k: string; n: number }[]) => { const o: Record<string, number> = {}; for (const r of rows) o[r.k] = r.n; return o; };
  return {
    total: totalRows[0]?.n ?? 0,
    rank: toMap(rankRows),
    gender: toMap(genderRows),
    jobType: toMap(jobRows),
    ageBand: toMap(ageRows),
  };
}
