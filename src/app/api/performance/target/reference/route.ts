// T-073: 目標設定ポップアップ左側の参考値。
// 昨年同月 / 前月 / 直近3か月 / 直近半年 の各段階の実績（数・率）を返す。
// 集計は T-071 確定の computeCaMetricsForRange（担当軸・到達ベース・無効含む・アーカイブ除く）を流用。
// 期間レンジは対象 yearMonth を基準に算出する（実績表の「今日起点」ではなく、目標を立てる月が基準）。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { computeCaMetricsForRange, type CaRangeMetrics } from "@/lib/dailyReport/metrics";
import { jstMonthRangeStart, jstMonthRangeEnd } from "@/lib/dailyReport/jstDate";

const YYYY_MM = /^\d{4}-(0[1-9]|1[0-2])$/;

// "YYYY-MM" を month 単位で前後に動かす。
function shiftMonth(yearMonth: string, deltaMonths: number): string {
  const [y, m] = yearMonth.split("-").map((s) => parseInt(s, 10));
  const idx = y * 12 + (m - 1) + deltaMonths;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employeeId");
  const yearMonth = searchParams.get("yearMonth");

  if (!employeeId || !yearMonth || !YYYY_MM.test(yearMonth)) {
    return NextResponse.json({ error: "employeeId と yearMonth(YYYY-MM) が必要です" }, { status: 400 });
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, userId: true },
  });
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });
  const userId = employee.userId ?? "__nonexistent__";

  // 参考期間：昨年同月 / 前月 / 直近3か月 / 直近半年（いずれも yearMonth を基準）。
  const lastYearSameMonth = shiftMonth(yearMonth, -12);
  const prevMonth = shiftMonth(yearMonth, -1);
  // 直近3か月＝前月から遡って3か月（yearMonth は未来の目標月なので含めない）。
  const quarterFrom = shiftMonth(yearMonth, -3);
  const halfFrom = shiftMonth(yearMonth, -6);

  const periodDefs: { key: string; fromMonth: string; toMonth: string }[] = [
    { key: "lastYearSameMonth", fromMonth: lastYearSameMonth, toMonth: lastYearSameMonth },
    { key: "prevMonth", fromMonth: prevMonth, toMonth: prevMonth },
    { key: "quarter", fromMonth: quarterFrom, toMonth: prevMonth },
    { key: "half", fromMonth: halfFrom, toMonth: prevMonth },
  ];

  const results = await Promise.all(
    periodDefs.map(async (d) => {
      const from = jstMonthRangeStart(d.fromMonth);
      const to = jstMonthRangeEnd(d.toMonth);
      const metrics = await computeCaMetricsForRange({ userId, employeeId: employee.id, from, to });
      return [d.key, { fromMonth: d.fromMonth, toMonth: d.toMonth, metrics }] as [
        string,
        { fromMonth: string; toMonth: string; metrics: CaRangeMetrics },
      ];
    }),
  );

  const reference: Record<string, { fromMonth: string; toMonth: string; metrics: CaRangeMetrics }> = {};
  for (const [k, v] of results) reference[k] = v;

  return NextResponse.json({
    employee: { id: employee.id, name: employee.name },
    yearMonth,
    reference,
  });
}
