import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET(req: Request) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) dateFilter.lte = new Date(to);

  const where = Object.keys(dateFilter).length > 0
    ? { occurredAt: dateFilter }
    : {};

  const [openCount, logs, knownErrorStats] = await Promise.all([
    prisma.rpaErrorLog.count({ where: { ...where, status: { not: "解決済み" } } }),
    prisma.rpaErrorLog.findMany({
      where,
      select: { machineNumber: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
    }),
    prisma.rpaErrorLog.groupBy({
      by: ["knownErrorId"],
      where: { ...where, knownErrorId: { not: null } },
      _count: true,
      orderBy: { _count: { knownErrorId: "desc" } },
      take: 5,
    }),
  ]);

  // 号機別月別集計
  const byMachineMonth: Record<string, Record<number, number>> = {};
  for (const log of logs) {
    const month = log.occurredAt.toISOString().slice(0, 7);
    if (!byMachineMonth[month]) byMachineMonth[month] = {};
    byMachineMonth[month][log.machineNumber] =
      (byMachineMonth[month][log.machineNumber] || 0) + 1;
  }

  // 既知エラーランキング
  const knownErrorIds = knownErrorStats
    .map((s) => s.knownErrorId)
    .filter((id): id is string => !!id);
  const knownErrors = knownErrorIds.length > 0
    ? await prisma.rpaKnownError.findMany({
        where: { id: { in: knownErrorIds } },
        select: { id: true, patternName: true },
      })
    : [];

  const ranking = knownErrorStats.map((s) => ({
    patternName: knownErrors.find((e) => e.id === s.knownErrorId)?.patternName ?? "不明",
    count: s._count,
  }));

  return NextResponse.json({
    openCount,
    byMachineMonth,
    ranking,
  });
}
