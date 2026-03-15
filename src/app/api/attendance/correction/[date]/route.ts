import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ date: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { date } = await params;
  const employee = await prisma.employee.findFirst({
    where: { name: user.name, status: "active" },
  });
  if (!employee) return NextResponse.json({ attendance: null, punches: [] });

  const attendance = await prisma.dailyAttendance.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: new Date(date + "T00:00:00Z") } },
    include: { punchEvents: { orderBy: { timestamp: "asc" } } },
  });

  if (!attendance) return NextResponse.json({ attendance: null, punches: [] });

  return NextResponse.json({
    attendance: {
      id: attendance.id,
      status: attendance.status,
      clockIn: attendance.clockIn,
      clockOut: attendance.clockOut,
      isFinalized: attendance.isFinalized,
    },
    punches: attendance.punchEvents.map((p) => ({
      id: p.id,
      type: p.type,
      timestamp: p.timestamp,
      isManualEdit: p.isManualEdit,
    })),
  });
}
