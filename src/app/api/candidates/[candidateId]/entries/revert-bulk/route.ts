import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";

type RouteContext = { params: Promise<{ candidateId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId } = await context.params;
  const body = await request.json();
  const { entryIds } = body as { entryIds: string[] };

  if (!entryIds?.length) {
    return NextResponse.json({ error: "entryIds is required" }, { status: 400 });
  }

  const entries = await prisma.jobEntry.findMany({
    where: { id: { in: entryIds }, candidateId },
    select: { id: true },
  });

  if (entries.length === 0) {
    return NextResponse.json({ error: "対象のエントリーが見つかりません" }, { status: 404 });
  }

  const ids = entries.map((e) => e.id);
  await prisma.jobEntry.deleteMany({ where: { id: { in: ids } } });

  try {
    await recalculateSubStatusIfAuto(candidateId);
  } catch (e) {
    console.error("[entries.revert-bulk] recalculateSubStatusIfAuto failed:", e);
  }

  return NextResponse.json({
    success: true,
    reverted: ids.length,
    message: `${ids.length}件のエントリーを求人紹介に戻しました`,
  });
}
