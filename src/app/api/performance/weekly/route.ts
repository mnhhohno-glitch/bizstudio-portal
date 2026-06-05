// T-071 週マトリクス API：起算日から 5 週に分割し、各週の実績（FileMaker 形）＋目標＋TOTAL＋達成率を返す。
//
// 実績は computeWeeklyMatrix（weeklyMatrix.ts、raw SQL）で算出。
//   - 面談：初回/2回目/3回目以降/合計
//   - 求人紹介・エントリー：新規/既存/合計 × 件数・人数・1人当たり
//   - 選考状況：書類通過・内定・承諾（人数）＋決定売上・決定単価
// TOTAL は週別合計ではなく「起算日〜W5末の全期間」で再集計（ユニーク重複排除）。
// 目標は対象月（起算日が属する JST 年月）の PerformanceTarget を週営業日按分（T-073 allocateToWeeks）。
// 達成率＝TOTAL 実績 ÷ TOTAL 目標（人数の達成率）。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { computeWeeklyMatrix, type WeeklyMatrix } from "@/lib/performance/weeklyMatrix";
import { splitIntoFiveWeeks } from "@/lib/performance/fiveWeeks";
import { allocateToWeeks, type WeekBucket } from "@/lib/performance/businessDays";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 目標を持つ主要メトリクス（按分・達成率の対象）
type TargetMetricKey = "interviewFirst" | "proposalUniq" | "entryUniq" | "documentPass" | "offer" | "acceptance";

function actualOf(m: WeeklyMatrix, key: TargetMetricKey): number {
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
  if (den == null || den <= 0) return null;
  return num / den;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employeeId");
  const anchorDate = searchParams.get("anchorDate");
  if (!employeeId || !anchorDate || !DATE_RE.test(anchorDate)) {
    return NextResponse.json({ error: "employeeId と anchorDate(YYYY-MM-DD) が必要です" }, { status: 400 });
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, userId: true },
  });
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });
  const userId = employee.userId ?? "__nonexistent__";

  const weeks = splitIntoFiveWeeks(anchorDate);

  // 各週の実績＋TOTAL（全期間再集計）を並列
  const [weeklyMatrices, totalMatrix] = await Promise.all([
    Promise.all(weeks.map((w) => computeWeeklyMatrix({ employeeId: employee.id, userId, from: w.from, to: w.to }))),
    computeWeeklyMatrix({ employeeId: employee.id, userId, from: weeks[0].from, to: weeks[weeks.length - 1].to }),
  ]);

  // 目標（対象月）
  const yearMonth = anchorDate.slice(0, 7);
  const target = await prisma.performanceTarget.findUnique({
    where: { employeeId_yearMonth: { employeeId: employee.id, yearMonth } },
  });

  const monthTargets: Record<TargetMetricKey, number | null> = {
    interviewFirst: target?.interviewCount ?? null,
    proposalUniq: target?.introductionCount ?? null,
    entryUniq: target?.entryCount ?? null,
    documentPass: target?.documentPassCount ?? null,
    offer: target?.offerCount ?? null,
    acceptance: target?.acceptanceCount ?? null,
  };

  // 5 週営業日按分
  const buckets: WeekBucket[] = weeks.map((w) => ({
    weekIndex: w.weekIndex, startDate: w.fromDateStr, endDate: w.toDateStr, businessDays: w.businessDays,
  }));
  const allocByKey: Record<TargetMetricKey, (number | null)[]> = {} as Record<TargetMetricKey, (number | null)[]>;
  (Object.keys(monthTargets) as TargetMetricKey[]).forEach((k) => {
    const v = monthTargets[k];
    allocByKey[k] = v == null ? weeks.map(() => null) : allocateToWeeks(v, buckets);
  });

  const weeksOut = weeks.map((w, i) => {
    const targets: Record<TargetMetricKey, number | null> = {
      interviewFirst: allocByKey.interviewFirst[i],
      proposalUniq: allocByKey.proposalUniq[i],
      entryUniq: allocByKey.entryUniq[i],
      documentPass: allocByKey.documentPass[i],
      offer: allocByKey.offer[i],
      acceptance: allocByKey.acceptance[i],
    };
    return {
      weekIndex: w.weekIndex,
      label: w.label,
      from: w.fromDateStr,
      to: w.toDateStr,
      businessDays: w.businessDays,
      matrix: weeklyMatrices[i],
      targets,
    };
  });

  const achievement: Record<TargetMetricKey, number | null> = {
    interviewFirst: rate(actualOf(totalMatrix, "interviewFirst"), monthTargets.interviewFirst),
    proposalUniq: rate(actualOf(totalMatrix, "proposalUniq"), monthTargets.proposalUniq),
    entryUniq: rate(actualOf(totalMatrix, "entryUniq"), monthTargets.entryUniq),
    documentPass: rate(actualOf(totalMatrix, "documentPass"), monthTargets.documentPass),
    offer: rate(actualOf(totalMatrix, "offer"), monthTargets.offer),
    acceptance: rate(actualOf(totalMatrix, "acceptance"), monthTargets.acceptance),
  };

  return NextResponse.json({
    employee: { id: employee.id, name: employee.name },
    anchorDate,
    yearMonth,
    targetExists: !!target,
    weeks: weeksOut,
    total: {
      from: weeks[0].fromDateStr,
      to: weeks[weeks.length - 1].toDateStr,
      matrix: totalMatrix,
      targets: monthTargets,
      achievement,
    },
  });
}
