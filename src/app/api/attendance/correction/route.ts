import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ModReqType } from "@prisma/client";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const employee = await prisma.employee.findFirst({
    where: { name: user.name, status: "active" },
  });
  if (!employee) return NextResponse.json({ error: "社員情報が見つかりません" }, { status: 404 });

  const body = await request.json();
  const { targetDate, requestType, beforeValue, afterValue, reason } = body;

  if (!targetDate || !requestType || !reason?.trim()) {
    return NextResponse.json({ error: "必須項目を入力してください" }, { status: 400 });
  }

  const modReq = await prisma.modificationRequest.create({
    data: {
      employeeId: employee.id,
      targetDate: new Date(targetDate),
      requestType: requestType as ModReqType,
      beforeValue: beforeValue ? new Date(beforeValue) : null,
      afterValue: afterValue ? new Date(afterValue) : null,
      reason: reason.trim(),
    },
  });

  return NextResponse.json({ id: modReq.id }, { status: 201 });
}
