import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { LeaveType, HalfDayType } from "@prisma/client";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const employee = await prisma.employee.findFirst({
    where: { name: user.name, status: "active" },
  });
  if (!employee) return NextResponse.json({ error: "社員情報が見つかりません" }, { status: 404 });

  const body = await request.json();
  const { targetDate, leaveType, halfDay, reason } = body;

  if (!targetDate || !leaveType) {
    return NextResponse.json({ error: "必須項目を入力してください" }, { status: 400 });
  }

  // 有給残日数チェック
  if (leaveType === "PAID_FULL" || leaveType === "PAID_HALF") {
    const deduction = leaveType === "PAID_HALF" ? 0.5 : 1;
    if (employee.paidLeave < deduction) {
      return NextResponse.json({ error: "有給残日数が不足しています" }, { status: 400 });
    }
  }

  const leaveReq = await prisma.leaveRequest.create({
    data: {
      employeeId: employee.id,
      targetDate: new Date(targetDate),
      leaveType: leaveType as LeaveType,
      halfDay: (halfDay as HalfDayType) || null,
      reason: reason?.trim() || null,
    },
  });

  return NextResponse.json({ id: leaveReq.id }, { status: 201 });
}
