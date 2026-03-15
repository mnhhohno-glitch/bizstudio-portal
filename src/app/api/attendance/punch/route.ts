import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { executePunch } from "@/lib/attendance/punch";
import type { PunchType } from "@prisma/client";

const VALID_PUNCH_TYPES: PunchType[] = [
  "CLOCK_IN", "BREAK_START", "BREAK_END",
  "INTERRUPT_START", "INTERRUPT_END", "CLOCK_OUT",
];

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { punchType } = body;

    if (!punchType || !VALID_PUNCH_TYPES.includes(punchType)) {
      return NextResponse.json({ error: "不正な打刻タイプです" }, { status: 400 });
    }

    // UserからEmployeeを取得
    const employee = await prisma.employee.findFirst({
      where: { name: user.name, status: "active" },
    });

    if (!employee) {
      return NextResponse.json({ error: "社員情報が見つかりません" }, { status: 404 });
    }

    const result = await executePunch(employee.id, punchType);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error, validationErrors: result.validationErrors },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("打刻APIエラー:", error);
    return NextResponse.json({ error: "打刻に失敗しました" }, { status: 500 });
  }
}
