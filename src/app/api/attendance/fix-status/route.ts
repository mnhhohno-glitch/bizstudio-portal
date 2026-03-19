import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const allAttendances = await prisma.dailyAttendance.findMany({
      where: { status: "NOT_STARTED" },
      include: {
        punchEvents: { orderBy: { timestamp: "asc" } },
      },
    });

    const results: string[] = [];

    for (const attendance of allAttendances) {
      const clockIn = attendance.punchEvents.find((e) => e.type === "CLOCK_IN");
      if (!clockIn) continue;

      const clockOut = attendance.punchEvents.find((e) => e.type === "CLOCK_OUT");
      const lastEvent = attendance.punchEvents[attendance.punchEvents.length - 1];

      let newStatus: "WORKING" | "FINISHED" | "ON_BREAK" | "INTERRUPTED" = "WORKING";
      if (clockOut) {
        newStatus = "FINISHED";
      } else if (lastEvent?.type === "BREAK_START") {
        newStatus = "ON_BREAK";
      } else if (lastEvent?.type === "INTERRUPT_START") {
        newStatus = "INTERRUPTED";
      }

      await prisma.dailyAttendance.update({
        where: { id: attendance.id },
        data: {
          status: newStatus,
          clockIn: clockIn.timestamp,
          clockOut: clockOut?.timestamp ?? null,
          isFinalized: newStatus === "FINISHED",
        },
      });

      results.push(
        `${attendance.date.toISOString().slice(0, 10)} (employeeId: ${attendance.employeeId}) → ${newStatus}`
      );
    }

    return NextResponse.json({
      message: `${results.length}件修正しました`,
      total: allAttendances.length,
      fixed: results.length,
      details: results,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("fix-status エラー:", err);
    return NextResponse.json(
      { error: err.message, stack: err.stack },
      { status: 500 }
    );
  }
}
