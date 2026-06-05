// T-071: 実績表 API。指定 CA（employeeId）の 6 期間分の CA 指標をまとめて返す。
// 閲覧権限は全 CA 可（確定仕様。admin 限定にしない）。ログインのみ必須。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { computeCaMetricsForRange, type CaRangeMetrics } from "@/lib/dailyReport/metrics";
import {
  PERFORMANCE_PERIODS,
  periodRange,
  type PerformancePeriodKey,
} from "@/lib/dailyReport/periods";
import {
  jstMonthRangeEnd,
  jstMonthRangeStart,
  todayJstDateString,
} from "@/lib/dailyReport/jstDate";

const YYYY_MM = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  let employeeId = searchParams.get("employeeId");

  // employeeId 未指定ならログインユーザー本人の Employee を解決（page.tsx L43-49 パターン）。
  if (!employeeId) {
    const self = await prisma.employee.findFirst({
      where: { name: user.name, status: "active" },
      select: { id: true },
    });
    employeeId = self?.id ?? null;
  }

  if (!employeeId) {
    return NextResponse.json({ error: "employee not found" }, { status: 404 });
  }

  // employeeId → userId（求人検索/紹介は User.id キー）+ 名前/職種を解決。
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, userId: true, jobCategory: true },
  });
  if (!employee) {
    return NextResponse.json({ error: "employee not found" }, { status: 404 });
  }

  const todayStr = todayJstDateString();
  // userId が無い Employee は求人検索/紹介が 0 件になるが、面談/エントリーは集計できる。
  const userId = employee.userId ?? "__nonexistent__";

  const results = await Promise.all(
    PERFORMANCE_PERIODS.map(async (p) => {
      const { from, to } = periodRange(p.key, todayStr);
      const metrics = await computeCaMetricsForRange({
        userId,
        employeeId: employee.id,
        from,
        to,
      });
      return [p.key, metrics] as [PerformancePeriodKey, CaRangeMetrics];
    }),
  );

  const periods: Record<string, CaRangeMetrics> = {};
  for (const [key, m] of results) periods[key] = m;

  // T-072: 月範囲指定（fromMonth/toMonth が両方与えられた場合のみ）。
  // 形式は "YYYY-MM"。範囲は fromMonth の月初〜toMonth の月末（JST）。
  // fromMonth > toMonth は 400 を返す（フロント側でもガード）。
  const fromMonth = searchParams.get("fromMonth");
  const toMonth = searchParams.get("toMonth");
  let customRange: { fromMonth: string; toMonth: string; metrics: CaRangeMetrics } | null = null;
  if (fromMonth || toMonth) {
    if (!fromMonth || !toMonth) {
      return NextResponse.json(
        { error: "fromMonth と toMonth は両方指定してください" },
        { status: 400 },
      );
    }
    if (!YYYY_MM.test(fromMonth) || !YYYY_MM.test(toMonth)) {
      return NextResponse.json(
        { error: "fromMonth/toMonth は YYYY-MM 形式で指定してください" },
        { status: 400 },
      );
    }
    if (fromMonth > toMonth) {
      return NextResponse.json(
        { error: "fromMonth は toMonth 以前である必要があります" },
        { status: 400 },
      );
    }
    const from = jstMonthRangeStart(fromMonth);
    const to = jstMonthRangeEnd(toMonth);
    const metrics = await computeCaMetricsForRange({
      userId,
      employeeId: employee.id,
      from,
      to,
    });
    customRange = { fromMonth, toMonth, metrics };
  }

  return NextResponse.json({
    today: todayStr,
    employee: { id: employee.id, name: employee.name, jobCategory: employee.jobCategory },
    periods,
    customRange,
  });
}
