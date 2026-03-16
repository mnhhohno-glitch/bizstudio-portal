import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ModReqType } from "@prisma/client";
import { notifyAdminModificationRequest } from "@/lib/attendance/lineworks-notify";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const employee = await prisma.employee.findFirst({
    where: { name: user.name, status: "active" },
  });
  if (!employee) return NextResponse.json({ error: "社員情報が見つかりません" }, { status: 404 });

  const body = await request.json();
  const { targetDate, items, reason } = body;

  if (!targetDate || !reason?.trim()) {
    return NextResponse.json({ error: "必須項目を入力してください" }, { status: 400 });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "修正する項目を選択してください" }, { status: 400 });
  }

  const modReq = await prisma.modificationRequest.create({
    data: {
      employeeId: employee.id,
      targetDate: new Date(targetDate),
      reason: reason.trim(),
      items: {
        create: items.map((item: { requestType: string; beforeValue: string | null; afterTime: string }) => ({
          requestType: item.requestType as ModReqType,
          beforeValue: item.beforeValue ? new Date(item.beforeValue) : null,
          afterValue: new Date(`${targetDate}T${item.afterTime}:00+09:00`),
        })),
      },
    },
    include: { items: true },
  });

  // LINE WORKS通知（非同期）
  notifyAdminModificationRequest(modReq.id).catch((e) => console.error("LINE通知エラー:", e));

  return NextResponse.json({ id: modReq.id }, { status: 201 });
}
