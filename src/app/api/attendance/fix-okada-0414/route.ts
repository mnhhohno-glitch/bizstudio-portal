import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const employee = await prisma.employee.findFirst({
      where: { employeeNumber: "1000007" },
    });
    if (!employee) {
      return NextResponse.json({ error: "岡田愛子が見つかりません" }, { status: 404 });
    }

    const targetDate = new Date("2026-04-14T00:00:00.000Z");
    const attendance = await prisma.dailyAttendance.findFirst({
      where: { employeeId: employee.id, date: targetDate },
      include: { punchEvents: { orderBy: { timestamp: "asc" } } },
    });
    if (!attendance) {
      return NextResponse.json({ error: "4/14の勤怠データが見つかりません" }, { status: 404 });
    }

    // 壊れた状態:
    //   BREAK_START 12:07 JST (正規・保持)
    //   BREAK_START 13:19 JST (本来 BREAK_END → 削除して BREAK_END として作り直し)
    //   BREAK_START 13:19 JST (重複 → 削除)
    const breakStarts = attendance.punchEvents.filter((e) => e.type === "BREAK_START");

    if (breakStarts.length >= 2) {
      const endTimestamp = breakStarts[1].timestamp;

      await prisma.punchEvent.deleteMany({
        where: { id: { in: breakStarts.slice(1).map((e) => e.id) } },
      });

      await prisma.punchEvent.create({
        data: {
          employeeId: employee.id,
          dailyAttendanceId: attendance.id,
          type: "BREAK_END",
          timestamp: endTimestamp,
          isManualEdit: true,
        },
      });
    }

    // DailyAttendance を再計算
    const events = await prisma.punchEvent.findMany({
      where: { dailyAttendanceId: attendance.id },
      orderBy: { timestamp: "asc" },
    });

    const clockIn = events.find((e) => e.type === "CLOCK_IN");
    const clockOut = events.find((e) => e.type === "CLOCK_OUT");
    const breakStartsNew = events
      .filter((e) => e.type === "BREAK_START")
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const breakEndsNew = events
      .filter((e) => e.type === "BREAK_END")
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    let totalBreak = 0;
    for (let i = 0; i < Math.min(breakStartsNew.length, breakEndsNew.length); i++) {
      totalBreak += Math.floor(
        (breakEndsNew[i].timestamp.getTime() - breakStartsNew[i].timestamp.getTime()) / 1000
      );
    }

    let totalWork = 0;
    if (clockIn && clockOut) {
      const gross = Math.floor((clockOut.timestamp.getTime() - clockIn.timestamp.getTime()) / 1000);
      totalWork = Math.max(0, gross - totalBreak);
    }
    const overtime = Math.max(0, totalWork - 28800);

    await prisma.dailyAttendance.update({
      where: { id: attendance.id },
      data: {
        totalBreak,
        totalWork,
        overtime,
        overtimeRounded: Math.floor(overtime / 60) * 60,
        isFinalized: true,
        status: "FINISHED",
      },
    });

    return NextResponse.json({
      message: "4/14岡田愛子のデータ修復完了",
      totalBreak: `${Math.floor(totalBreak / 60)}分`,
      totalWork: `${Math.floor(totalWork / 3600)}時間${Math.floor((totalWork % 3600) / 60)}分`,
      events: events.map((e) => ({
        type: e.type,
        timestamp: e.timestamp,
      })),
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("fix-okada エラー:", err);
    return NextResponse.json(
      { error: err.message, stack: err.stack },
      { status: 500 }
    );
  }
}
