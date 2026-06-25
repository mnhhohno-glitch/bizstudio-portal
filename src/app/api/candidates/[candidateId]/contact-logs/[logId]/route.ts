import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ candidateId: string; logId: string }> };

// T-111: 連絡記録の削除（編集は今回スコープ外）。
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId, logId } = await context.params;

  const existing = await prisma.contactLog.findUnique({ where: { id: logId } });
  if (!existing || existing.candidateId !== candidateId) {
    return NextResponse.json({ error: "連絡記録が見つかりません" }, { status: 404 });
  }

  await prisma.contactLog.delete({ where: { id: logId } });

  return NextResponse.json({ ok: true });
}
