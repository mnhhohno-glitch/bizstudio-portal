// T-071 週マトリクス API：起算日から 5 週に分割し、各週の実績＋目標＋TOTAL＋達成率を返す。
//
// 集計の数え方は computeCaMetricsForRange と同じ（変更しない）：
//   - 担当軸：candidate.employeeId
//   - エントリー以降：候補者ユニーク人数（COUNT DISTINCT candidateId）
//   - 求人検索/紹介：件数（User.id 軸）
//   - 面談：現状の数え方
//   - 無効含む・アーカイブ除く
//
// TOTAL（5週合計）の人数指標は、**週別ユニークの単純合計ではなく、
// 起算日〜W5末の全期間で再集計**したユニーク人数（複数週にまたがる同一候補者の重複を排除）。
// → 週別合計と TOTAL が一致しないことがあるのは仕様（ユニークの性質）。
//
// 目標は対象月（起算日が属する JST 年月）の PerformanceTarget を取得し、
// T-073 の allocateToWeeks で 5 週営業日按分（各週切り上げ＋最終週で帳尻 → 合計＝月目標）。
// 対象月の目標が未登録なら null（UI で「—」表示）。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  computeCaMetricsForRange,
  type CaRangeMetrics,
} from "@/lib/dailyReport/metrics";
import { splitIntoFiveWeeks } from "@/lib/performance/fiveWeeks";
import { allocateToWeeks, type WeekBucket } from "@/lib/performance/businessDays";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface StageNumbers {
  interview: number;
  introduction: number;
  entry: number;
  documentPass: number;
  offer: number;
  acceptance: number;
}

function extractStages(m: CaRangeMetrics): StageNumbers {
  return {
    interview: m.firstInterviewExecuted,
    introduction: m.jobIntroduced,
    entry: m.entry.count,
    documentPass: m.documentPass.count,
    offer: m.offer.count,
    acceptance: m.acceptance.count,
  };
}

function rate(num: number, den: number): number | null {
  if (den <= 0) return null;
  return num / den;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employeeId");
  const anchorDate = searchParams.get("anchorDate");
  if (!employeeId || !anchorDate || !DATE_RE.test(anchorDate)) {
    return NextResponse.json(
      { error: "employeeId と anchorDate(YYYY-MM-DD) が必要です" },
      { status: 400 },
    );
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, userId: true },
  });
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });
  const userId = employee.userId ?? "__nonexistent__";

  // 5 週分割
  const weeks = splitIntoFiveWeeks(anchorDate);

  // 各週の実績（並列）
  const weeklyMetrics = await Promise.all(
    weeks.map((w) =>
      computeCaMetricsForRange({ userId, employeeId: employee.id, from: w.from, to: w.to }),
    ),
  );

  // TOTAL は 起算日〜W5末 の全期間で再集計（人数のユニーク重複排除のため）。
  const totalFrom = weeks[0].from;
  const totalTo = weeks[weeks.length - 1].to;
  const totalMetrics = await computeCaMetricsForRange({
    userId,
    employeeId: employee.id,
    from: totalFrom,
    to: totalTo,
  });

  // 目標（対象月＝起算日が属する JST 年月）
  const yearMonth = anchorDate.slice(0, 7);
  const target = await prisma.performanceTarget.findUnique({
    where: { employeeId_yearMonth: { employeeId: employee.id, yearMonth } },
  });

  // 5 週営業日按分（T-073 allocateToWeeks を流用）
  const weekBuckets: WeekBucket[] = weeks.map((w) => ({
    weekIndex: w.weekIndex,
    startDate: w.fromDateStr,
    endDate: w.toDateStr,
    businessDays: w.businessDays,
  }));

  const targetStages: Record<keyof StageNumbers, number | null> = target
    ? {
        interview: target.interviewCount,
        introduction: target.introductionCount,
        entry: target.entryCount,
        documentPass: target.documentPassCount,
        offer: target.offerCount,
        acceptance: target.acceptanceCount,
      }
    : { interview: null, introduction: null, entry: null, documentPass: null, offer: null, acceptance: null };

  // 各段階の週別目標
  const weeklyTargetsByStage: Record<keyof StageNumbers, (number | null)[]> = {
    interview: targetStages.interview === null ? weeks.map(() => null) : allocateToWeeks(targetStages.interview, weekBuckets),
    introduction: targetStages.introduction === null ? weeks.map(() => null) : allocateToWeeks(targetStages.introduction, weekBuckets),
    entry: targetStages.entry === null ? weeks.map(() => null) : allocateToWeeks(targetStages.entry, weekBuckets),
    documentPass: targetStages.documentPass === null ? weeks.map(() => null) : allocateToWeeks(targetStages.documentPass, weekBuckets),
    offer: targetStages.offer === null ? weeks.map(() => null) : allocateToWeeks(targetStages.offer, weekBuckets),
    acceptance: targetStages.acceptance === null ? weeks.map(() => null) : allocateToWeeks(targetStages.acceptance, weekBuckets),
  };

  // レスポンス整形
  const weeksOut = weeks.map((w, i) => {
    const m = weeklyMetrics[i];
    const actual = extractStages(m);
    const target: Record<keyof StageNumbers, number | null> = {
      interview: weeklyTargetsByStage.interview[i],
      introduction: weeklyTargetsByStage.introduction[i],
      entry: weeklyTargetsByStage.entry[i],
      documentPass: weeklyTargetsByStage.documentPass[i],
      offer: weeklyTargetsByStage.offer[i],
      acceptance: weeklyTargetsByStage.acceptance[i],
    };
    return {
      weekIndex: w.weekIndex,
      label: w.label,
      from: w.fromDateStr,
      to: w.toDateStr,
      businessDays: w.businessDays,
      actual,
      target,
    };
  });

  const totalActual = extractStages(totalMetrics);
  // TOTAL 目標 = 月目標そのまま（5週按分の合計＝月目標を保証している）。
  const totalTarget = targetStages;

  // 達成率（TOTAL 実績 ÷ TOTAL 目標）。人数の達成率。段階間の転換率とは別物。
  const achievement: Record<keyof StageNumbers, number | null> = {
    interview: totalTarget.interview === null ? null : rate(totalActual.interview, totalTarget.interview),
    introduction: totalTarget.introduction === null ? null : rate(totalActual.introduction, totalTarget.introduction),
    entry: totalTarget.entry === null ? null : rate(totalActual.entry, totalTarget.entry),
    documentPass: totalTarget.documentPass === null ? null : rate(totalActual.documentPass, totalTarget.documentPass),
    offer: totalTarget.offer === null ? null : rate(totalActual.offer, totalTarget.offer),
    acceptance: totalTarget.acceptance === null ? null : rate(totalActual.acceptance, totalTarget.acceptance),
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
      actual: totalActual,
      target: totalTarget,
      achievement,
    },
  });
}
