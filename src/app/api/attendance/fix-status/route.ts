import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { calculateDailyTotals } from "@/lib/attendance/calculator";

export async function GET() {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const brokenRecords = await prisma.dailyAttendance.findMany({
    where: { status: "NOT_STARTED" },
    include: {
      punchEvents: { orderBy: { timestamp: "asc" } },
      employee: { select: { name: true } },
    },
  });

  const fixed: string[] = [];

  for (const record of brokenRecords) {
    const clockIn = record.punchEvents.find((e) => e.type === "CLOCK_IN");
    if (!clockIn) continue; // 本当に出勤なし

    const clockOut = record.punchEvents.find((e) => e.type === "CLOCK_OUT");
    const lastEvent = record.punchEvents[record.punchEvents.length - 1];

    let newStatus: "WORKING" | "FINISHED" | "ON_BREAK" | "INTERRUPTED" = "WORKING";
    if (clockOut) newStatus = "FINISHED";
    else if (lastEvent?.type === "BREAK_START") newStatus = "ON_BREAK";
    else if (lastEvent?.type === "INTERRUPT_START") newStatus = "INTERRUPTED";

    const totals = await calculateDailyTotals(record.id);

    await prisma.dailyAttendance.update({
      where: { id: record.id },
      data: {
        status: newStatus,
        clockIn: clockIn.timestamp,
        clockOut: clockOut?.timestamp ?? null,
        isFinalized: newStatus === "FINISHED",
        totalBreak: totals.totalBreak,
        totalInterrupt: totals.totalInterrupt,
        totalWork: totals.totalWork,
        overtime: totals.overtime,
        overtimeRounded: totals.overtimeRounded,
        nightTime: totals.nightTime,
        note: totals.note,
      },
    });

    const dateStr = record.date.toISOString().slice(0, 10);
    fixed.push(`${record.employee.name} ${dateStr}: NOT_STARTED → ${newStatus}`);
  }

  return NextResponse.json({
    total: brokenRecords.length,
    fixed: fixed.length,
    skipped: brokenRecords.length - fixed.length,
    details: fixed,
  });
}
