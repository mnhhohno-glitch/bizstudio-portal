// T-071 実績表マトリクス API（粒度 day/week/month 対応）。
// 起算日(anchorDate)を起点に、粒度に応じた列（日5/週5/月6）の実績＋目標＋TOTAL＋達成率を返す。
//
// 実績は computeWeeklyMatrix（weeklyMatrix.ts、raw SQL）を各列レンジで呼ぶ（数え方は変更しない）。
// TOTAL は列別合計ではなく「全列をカバーする全期間」で再集計（候補者ユニーク重複を排除）。
// 目標（粒度別）：
//   - week  ：起算月の月目標を 5 週営業日按分（allocateToWeeks）。TOTAL 目標＝月目標。
//   - day   ：起算月の月目標 ÷ 月営業日数 を「営業日の列」に配分（土日祝列は 0）。TOTAL＝列合計。
//   - month ：各列の月の登録目標をそのまま。未登録は null。TOTAL＝登録分の合計。
// 後方互換：granularity 未指定は week。
// エンドポイント名は weekly のまま（呼び出しは PerformancePanel のみ）。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { computeWeeklyMatrix, type WeeklyMatrix } from "@/lib/performance/weeklyMatrix";
import { buildColumns, type Granularity } from "@/lib/performance/columns";
import { allocateToWeeks, monthBusinessDays, type WeekBucket } from "@/lib/performance/businessDays";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type TKey = "interviewFirst" | "proposalUniq" | "entryUniq" | "documentPass" | "offer" | "acceptance";
const TKEYS: TKey[] = ["interviewFirst", "proposalUniq", "entryUniq", "documentPass", "offer", "acceptance"];

// PerformanceTarget のフィールド名
const TARGET_FIELD: Record<TKey, "interviewCount" | "introductionCount" | "entryCount" | "documentPassCount" | "offerCount" | "acceptanceCount"> = {
  interviewFirst: "interviewCount",
  proposalUniq: "introductionCount",
  entryUniq: "entryCount",
  documentPass: "documentPassCount",
  offer: "offerCount",
  acceptance: "acceptanceCount",
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
  if (den == null || den <= 0) return null;
  return num / den;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employeeId");
  const anchorDate = searchParams.get("anchorDate");
  const gParam = searchParams.get("granularity");
  const granularity: Granularity = gParam === "day" || gParam === "month" ? gParam : "week";

  if (!employeeId || !anchorDate || !DATE_RE.test(anchorDate)) {
    return NextResponse.json({ error: "employeeId と anchorDate(YYYY-MM-DD) が必要です" }, { status: 400 });
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, userId: true },
  });
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });
  const userId = employee.userId ?? "__nonexistent__";

  const columns = buildColumns(granularity, anchorDate);
  const anchorMonth = anchorDate.slice(0, 7);

  // 各列の実績＋TOTAL（全列カバー範囲で再集計）を並列
  const [columnMatrices, totalMatrix] = await Promise.all([
    Promise.all(columns.map((c) => computeWeeklyMatrix({ employeeId: employee.id, userId, from: c.from, to: c.to }))),
    computeWeeklyMatrix({ employeeId: employee.id, userId, from: columns[0].from, to: columns[columns.length - 1].to }),
  ]);

  // 目標：必要な月の PerformanceTarget をまとめて取得
  const neededMonths = Array.from(new Set([anchorMonth, ...columns.map((c) => c.yearMonth)]));
  const targetRows = await prisma.performanceTarget.findMany({
    where: { employeeId: employee.id, yearMonth: { in: neededMonths } },
  });
  const targetByMonth = new Map(targetRows.map((t) => [t.yearMonth, t]));
  const targetExists = (granularity === "month")
    ? columns.some((c) => targetByMonth.has(c.yearMonth))
    : targetByMonth.has(anchorMonth);

  // 粒度別の目標算出
  function targetVal(ym: string, key: TKey): number | null {
    const t = targetByMonth.get(ym);
    return t ? (t[TARGET_FIELD[key]] as number) : null;
  }

  // perColumnTargets[key] = 各列の目標、totalTargets[key] = TOTAL目標
  const perColumnTargets: Record<TKey, (number | null)[]> = {} as Record<TKey, (number | null)[]>;
  const totalTargets: Record<TKey, number | null> = {} as Record<TKey, number | null>;

  for (const key of TKEYS) {
    if (granularity === "week") {
      const monthT = targetVal(anchorMonth, key);
      const buckets: WeekBucket[] = columns.map((c) => ({ weekIndex: c.index, startDate: c.fromDateStr, endDate: c.toDateStr, businessDays: c.businessDays }));
      perColumnTargets[key] = monthT == null ? columns.map(() => null) : allocateToWeeks(monthT, buckets);
      totalTargets[key] = monthT;
    } else if (granularity === "day") {
      const monthT = targetVal(anchorMonth, key);
      const mBiz = monthBusinessDays(anchorMonth);
      const perDay = monthT != null && mBiz > 0 ? monthT / mBiz : null;
      perColumnTargets[key] = columns.map((c) => (perDay == null ? null : c.businessDays > 0 ? perDay : 0));
      totalTargets[key] = perDay == null ? null : perColumnTargets[key].reduce((s: number, v) => s + (v ?? 0), 0);
    } else {
      // month：各列の月の登録目標をそのまま。TOTAL は登録分の合計（全 null なら null）。
      const vals = columns.map((c) => targetVal(c.yearMonth, key));
      perColumnTargets[key] = vals;
      const present = vals.filter((v): v is number => v != null);
      totalTargets[key] = present.length > 0 ? present.reduce((s, v) => s + v, 0) : null;
    }
  }

  const columnsOut = columns.map((c, i) => {
    const targets: Record<TKey, number | null> = {} as Record<TKey, number | null>;
    for (const key of TKEYS) targets[key] = perColumnTargets[key][i];
    return {
      index: c.index,
      label: c.label,
      subLabel: c.subLabel,
      from: c.fromDateStr,
      to: c.toDateStr,
      businessDays: c.businessDays,
      matrix: columnMatrices[i],
      targets,
    };
  });

  const achievement: Record<TKey, number | null> = {} as Record<TKey, number | null>;
  for (const key of TKEYS) achievement[key] = rate(actualOf(totalMatrix, key), totalTargets[key]);

  return NextResponse.json({
    employee: { id: employee.id, name: employee.name },
    anchorDate,
    granularity,
    targetExists,
    columns: columnsOut,
    total: {
      from: columns[0].fromDateStr,
      to: columns[columns.length - 1].toDateStr,
      matrix: totalMatrix,
      targets: totalTargets,
      achievement,
    },
  });
}
