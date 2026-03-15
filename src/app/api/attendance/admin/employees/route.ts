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
    select: { id: true, employeeNumber: true, name: true, paidLeave: true, userId: true },
  });

  return NextResponse.json({ employees });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "管理者権限が必要です" }, { status: 403 });
  }

  const body = await request.json();
  const { employeeId, paidLeave } = body;

  if (!employeeId || paidLeave === undefined) {
    return NextResponse.json({ error: "必須項目が不足しています" }, { status: 400 });
  }

  await prisma.employee.update({
    where: { id: employeeId },
    data: { paidLeave: Number(paidLeave) },
  });

  return NextResponse.json({ success: true });
}
