import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { editPunchBeforeFinalize } from "@/lib/attendance/punch";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await request.json();
  const { punchEventId, newTimestamp } = body;

  if (!punchEventId || !newTimestamp) {
    return NextResponse.json({ error: "必須項目が不足しています" }, { status: 400 });
  }

  const result = await editPunchBeforeFinalize(punchEventId, new Date(newTimestamp));

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
