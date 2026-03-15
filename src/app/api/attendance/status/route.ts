import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
dayjs.extend(timezone);

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const employee = await prisma.employee.findFirst({
    where: { name: user.name, status: "active" },
  });
  if (!employee) return NextResponse.json({ employee: null, attendance: null, punches: [], userRole: user.role });

  const today = dayjs().tz("Asia/Tokyo").startOf("day").toDate();

  const attendance = await prisma.dailyAttendance.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: today } },
    include: { punchEvents: { orderBy: { timestamp: "asc" } } },
  });

  return NextResponse.json({
    userRole: user.role,
    employee: { id: employee.id, name: employee.name },
    attendance: attendance
      ? {
          id: attendance.id,
          status: attendance.status,
          clockIn: attendance.clockIn,
          clockOut: attendance.clockOut,
          isFinalized: attendance.isFinalized,
          totalWork: attendance.totalWork,
          totalBreak: attendance.totalBreak,
          totalInterrupt: attendance.totalInterrupt,
          overtime: attendance.overtime,
        }
      : null,
    punches: attendance?.punchEvents.map((p) => ({
      id: p.id,
      type: p.type,
      timestamp: p.timestamp,
      isManualEdit: p.isManualEdit,
    })) ?? [],
  });
}
