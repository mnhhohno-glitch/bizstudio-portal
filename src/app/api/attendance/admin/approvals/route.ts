import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "管理者権限が必要です" }, { status: 403 });
  }

  const [modRequests, leaveRequests] = await Promise.all([
    prisma.modificationRequest.findMany({
      where: { status: "PENDING" },
      include: { employee: { select: { name: true, employeeNumber: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.leaveRequest.findMany({
      where: { status: "PENDING" },
      include: { employee: { select: { name: true, employeeNumber: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const pending = [
    ...modRequests.map((r) => ({
      id: r.id,
      type: "modification" as const,
      token: r.approvalToken,
      employeeName: r.employee.name,
      targetDate: r.targetDate,
      requestType: r.requestType,
      reason: r.reason,
      createdAt: r.createdAt,
    })),
    ...leaveRequests.map((r) => ({
      id: r.id,
      type: "leave" as const,
      token: r.approvalToken,
      employeeName: r.employee.name,
      targetDate: r.targetDate,
      requestType: r.leaveType,
      reason: r.reason,
      createdAt: r.createdAt,
    })),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return NextResponse.json({ pending });
}
