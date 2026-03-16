import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "管理者権限が必要です" }, { status: 403 });
  }

  const employees = await prisma.employee.findMany({
    where: { status: "active" },
    orderBy: { employeeNumber: "asc" },
    select: { id: true, employeeNumber: true, name: true, paidLeave: true, userId: true, isExemptFromAttendance: true },
  });

  return NextResponse.json({ employees });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "管理者権限が必要です" }, { status: 403 });
  }

  const body = await request.json();
  const { employeeId, paidLeave, isExemptFromAttendance } = body;

  if (!employeeId) {
    return NextResponse.json({ error: "必須項目が不足しています" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (paidLeave !== undefined) data.paidLeave = Number(paidLeave);
  if (isExemptFromAttendance !== undefined) data.isExemptFromAttendance = Boolean(isExemptFromAttendance);

  await prisma.employee.update({ where: { id: employeeId }, data });

  return NextResponse.json({ success: true });
}
