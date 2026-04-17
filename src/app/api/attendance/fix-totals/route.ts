import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "管理者権限が必要です" }, { status: 403 });
  }

  try {
    // 承認済みのModificationRequestに紐づくDailyAttendanceをすべて再計算
    const approvedRequests = await prisma.modificationRequest.findMany({
      where: { status: "APPROVED" },
      select: { targetDate: true, employeeId: true },
    });

    const results: string[] = [];

    for (const req of approvedRequests) {
      const attendance = await prisma.dailyAttendance.findFirst({
        where: { employeeId: req.employeeId, date: req.targetDate },
        include: { punchEvents: { orderBy: { timestamp: "asc" } } },
      });
      if (!attendance) continue;

      const events = attendance.punchEvents;
      const clockIn = events.find((e) => e.type === "CLOCK_IN");
      const clockOut = events.find((e) => e.type === "CLOCK_OUT");

      if (!clockIn) continue;

      // 休憩ペアの計算
      const breakStarts = events
        .filter((e) => e.type === "BREAK_START")
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const breakEnds = events
        .filter((e) => e.type === "BREAK_END")
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      let totalBreak = 0;
      for (let i = 0; i < Math.min(breakStarts.length, breakEnds.length); i++) {
        totalBreak += Math.floor(
          (breakEnds[i].timestamp.getTime() - breakStarts[i].timestamp.getTime()) / 1000
        );
      }

      // 中断ペアの計算
      const intStarts = events
        .filter((e) => e.type === "INTERRUPT_START")
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const intEnds = events
        .filter((e) => e.type === "INTERRUPT_END")
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      let totalInterrupt = 0;
      for (let i = 0; i < Math.min(intStarts.length, intEnds.length); i++) {
        totalInterrupt += Math.floor(
          (intEnds[i].timestamp.getTime() - intStarts[i].timestamp.getTime()) / 1000
        );
      }

      // 実労働時間・残業時間
      let totalWork = 0;
      if (clockIn && clockOut) {
        const gross = Math.floor(
          (clockOut.timestamp.getTime() - clockIn.timestamp.getTime()) / 1000
        );
        totalWork = Math.max(0, gross - totalBreak - totalInterrupt);
      }
      const overtime = Math.max(0, totalWork - 28800);
      const overtimeRounded = Math.floor(overtime / 60) * 60;

      // ステータス判定
      let status: "WORKING" | "FINISHED" | "ON_BREAK" | "INTERRUPTED" = "WORKING";
      if (clockOut) {
        status = "FINISHED";
      } else {
        const lastEvent = events[events.length - 1];
        if (lastEvent?.type === "BREAK_START") status = "ON_BREAK";
        else if (lastEvent?.type === "INTERRUPT_START") status = "INTERRUPTED";
      }

      // 備考
      const note = breakStarts.length >= 2 ? `休憩${breakStarts.length}回` : null;

      await prisma.dailyAttendance.update({
        where: { id: attendance.id },
        data: {
          status,
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

      results.push(
        `${req.targetDate.toISOString().slice(0, 10)} (employeeId: ${req.employeeId}) → 再計算完了 休憩: ${totalBreak}秒, 実働: ${totalWork}秒`
      );
    }

    return NextResponse.json({
      message: `${results.length}件再計算しました`,
      total: approvedRequests.length,
      details: results,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("fix-totals エラー:", err);
    return NextResponse.json(
      { error: err.message, stack: err.stack },
      { status: 500 }
    );
  }
}
