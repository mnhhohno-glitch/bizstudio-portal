import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const approvedRequests = await prisma.modificationRequest.findMany({
      where: { status: "APPROVED" },
      select: { targetDate: true, employeeId: true },
    });

    const results: string[] = [];

    for (const req of approvedRequests) {
      const attendance = await prisma.dailyAttendance.findFirst({
        where: { employeeId: req.employeeId, date: req.targetDate },
        include: { punchEvents: { orderBy: { timestamp: "asc" } }, employee: { select: { name: true } } },
      });
      if (!attendance) continue;

      const events = attendance.punchEvents;
      const clockIn = events.find((e) => e.type === "CLOCK_IN");
      const clockOut = events.find((e) => e.type === "CLOCK_OUT");
      if (!clockIn) continue;

      const breakStarts = events.filter((e) => e.type === "BREAK_START");
      const breakEnds = events.filter((e) => e.type === "BREAK_END");
      let totalBreak = 0;
      for (let i = 0; i < Math.min(breakStarts.length, breakEnds.length); i++) {
        totalBreak += Math.floor((breakEnds[i].timestamp.getTime() - breakStarts[i].timestamp.getTime()) / 1000);
      }

      const intStarts = events.filter((e) => e.type === "INTERRUPT_START");
      const intEnds = events.filter((e) => e.type === "INTERRUPT_END");
      let totalInterrupt = 0;
      for (let i = 0; i < Math.min(intStarts.length, intEnds.length); i++) {
        totalInterrupt += Math.floor((intEnds[i].timestamp.getTime() - intStarts[i].timestamp.getTime()) / 1000);
      }

      let totalWork = 0;
      let overtime = 0;
      let overtimeRounded = 0;
      if (clockIn && clockOut) {
        const gross = Math.floor((clockOut.timestamp.getTime() - clockIn.timestamp.getTime()) / 1000);
        totalWork = Math.max(0, gross - totalBreak - totalInterrupt);
        overtime = Math.max(0, totalWork - 28800);
        overtimeRounded = Math.floor(overtime / 60) * 60;
      }

      let status: string = "WORKING";
      if (clockOut) status = "FINISHED";

      const breakCount = Math.min(breakStarts.length, breakEnds.length);
      const note = breakCount >= 2 ? `休憩${breakCount}回` : null;

      await prisma.dailyAttendance.update({
        where: { id: attendance.id },
        data: {
          status: status as "WORKING" | "FINISHED",
          clockIn: clockIn.timestamp,
          clockOut: clockOut?.timestamp ?? null,
          totalBreak,
          totalInterrupt,
          totalWork,
          overtime,
          overtimeRounded,
          isFinalized: status === "FINISHED",
          note,
        },
      });

      const dateStr = req.targetDate.toISOString().slice(0, 10);
      results.push(`${dateStr} ${attendance.employee.name} → 再計算完了 (break=${totalBreak}s, work=${totalWork}s)`);
    }

    return NextResponse.json({ message: `${results.length}件再計算しました`, details: results });
  } catch (error) {
    console.error("fix-totals エラー:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
