import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
dayjs.extend(timezone);

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const yearMonth = searchParams.get("month"); // "2026-03" format

  const employee = await prisma.employee.findFirst({
    where: { name: user.name, status: "active" },
  });
  if (!employee) return NextResponse.json({ records: [], leaves: [] });

  const now = dayjs().tz("Asia/Tokyo");
  const target = yearMonth ? dayjs(yearMonth + "-01").tz("Asia/Tokyo") : now;
  const monthStart = target.startOf("month").toDate();
  const monthEnd = target.endOf("month").toDate();

  const [records, leaves] = await Promise.all([
    prisma.dailyAttendance.findMany({
      where: { employeeId: employee.id, date: { gte: monthStart, lte: monthEnd } },
      include: { punchEvents: { orderBy: { timestamp: "asc" } } },
      orderBy: { date: "asc" },
    }),
    prisma.leaveRequest.findMany({
      where: { employeeId: employee.id, targetDate: { gte: monthStart, lte: monthEnd } },
      orderBy: { targetDate: "asc" },
    }),
  ]);

  return NextResponse.json({
    records: records.map((r) => ({
      id: r.id,
      date: r.date,
      status: r.status,
      clockIn: r.clockIn,
      clockOut: r.clockOut,
      totalWork: r.totalWork,
      totalBreak: r.totalBreak,
      overtime: r.overtime,
      isFinalized: r.isFinalized,
      note: r.note,
      punchCount: r.punchEvents.length,
    })),
    leaves: leaves.map((l) => ({
      id: l.id,
      date: l.targetDate,
      leaveType: l.leaveType,
      halfDay: l.halfDay,
      status: l.status,
    })),
    paidLeave: employee.paidLeave,
  });
}
