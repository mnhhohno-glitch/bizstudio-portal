import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // 岡田愛子を検索
    const employee = await prisma.employee.findFirst({
      where: { employeeNumber: "1000007" },
    });
    if (!employee) {
      return NextResponse.json({ error: "岡田愛子が見つかりません" }, { status: 404 });
    }

    // 4/14のDailyAttendanceを取得
    const targetDate = new Date("2026-04-14T00:00:00.000Z");
    const attendance = await prisma.dailyAttendance.findFirst({
      where: {
        employeeId: employee.id,
        date: targetDate,
      },
      include: {
        punchEvents: { orderBy: { timestamp: "asc" } },
      },
    });

    // ModificationRequestを取得
    const modRequests = await prisma.modificationRequest.findMany({
      where: {
        employeeId: employee.id,
        targetDate: targetDate,
      },
      include: { items: true },
    });

    return NextResponse.json(
      {
        employee: {
          id: employee.id,
          employeeNumber: employee.employeeNumber,
          name: employee.name,
        },
        attendance: attendance
          ? {
              id: attendance.id,
              date: attendance.date,
              status: attendance.status,
              clockIn: attendance.clockIn,
              clockOut: attendance.clockOut,
              totalBreak: attendance.totalBreak,
              totalWork: attendance.totalWork,
              punchEventCount: attendance.punchEvents.length,
              punchEvents: attendance.punchEvents.map((e) => ({
                type: e.type,
                timestamp: e.timestamp,
                isManualEdit: e.isManualEdit,
              })),
            }
          : null,
        modificationRequests: modRequests.map((r) => ({
          id: r.id,
          status: r.status,
          reason: r.reason,
          createdAt: r.createdAt,
          itemCount: r.items.length,
          items: r.items.map((i) => ({
            requestType: i.requestType,
            beforeValue: i.beforeValue,
            afterValue: i.afterValue,
          })),
        })),
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const err = error as Error;
    console.error("debug-events エラー:", err);
    return NextResponse.json(
      { error: err.message, stack: err.stack },
      { status: 500 }
    );
  }
}
