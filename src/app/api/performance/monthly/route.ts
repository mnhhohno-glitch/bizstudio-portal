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
import { computeWeeklyMatrix, applyAdditiveTotals } from "@/lib/performance/weeklyMatrix";
import { weeklyBusinessDays, monthBusinessDays, allocateToWeeks, type WeekBucket } from "@/lib/performance/businessDays";
import { computeInterviewAttributes } from "@/lib/performance/attributes";
import { aggregateAllCaTargets } from "@/lib/performance/aggregateTargets";
import { TKEYS, WEEK_ALLOCATED, targetValueOf, actualOf, rate, type TKey, type TargetRowLike } from "@/lib/performance/targetKeys";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  // 新規/既存(scoped)は当月全体でランク付け（各週=cell, ランク窓=当月）→ Σ週=合計。
  const rankWindow = { from: monthFrom, to: monthTo };
  // 各週マトリクス＋TOTAL（当月通算再集計）＋属性を並列。
  const [columnMatrices, totalMatrix, attributes] = await Promise.all([
    Promise.all(buckets.map((b) => computeWeeklyMatrix({ employeeId: resolvedEmployeeId, userId, from: jstStart(b.startDate), to: jstEnd(b.endDate), allCas, rankWindow }))),
    computeWeeklyMatrix({ employeeId: resolvedEmployeeId, userId, from: monthFrom, to: monthTo, allCas, rankWindow }),
    computeInterviewAttributes({ employeeId: resolvedEmployeeId, from: monthFrom, to: monthTo, allCas }),
  ]);
  // 合計列の人数・件数を各週の合算に置換（縦横一致）。
  applyAdditiveTotals(totalMatrix, columnMatrices);

  // 目標（当月の PerformanceTarget。週按分は initial面談・提案・エントリーのみ）。全員モードは全CA合算。
  const targetRow = allCas
    ? ((await aggregateAllCaTargets([yearMonth])).get(yearMonth) ?? null)
    : await prisma.performanceTarget.findUnique({
        where: { employeeId_yearMonth: { employeeId: resolvedEmployeeId, yearMonth } },
      });
  const targetExists = !!targetRow;
  const monthBiz = monthBusinessDays(yearMonth);

  const perColumnTargets: Record<TKey, (number | null)[]> = {} as Record<TKey, (number | null)[]>;
  const totalTargets: Record<TKey, number | null> = {} as Record<TKey, number | null>;
  for (const key of TKEYS) {
    const monthT = targetRow ? targetValueOf(targetRow as unknown as TargetRowLike, key) : null;
    totalTargets[key] = monthT;
    if (monthT == null || !WEEK_ALLOCATED[key]) {
      perColumnTargets[key] = buckets.map(() => null); // 書類通過以降・粗利単価・目標なしは週按分しない
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
