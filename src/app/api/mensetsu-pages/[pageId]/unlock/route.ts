// T-206: 生年月日の入力ミスによるロックを解除する（本人から問い合わせがあったとき用）
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/mensetsu/internal-api";
import { PAGE_INCLUDE, resetVerifyFailures, toPageRow } from "@/lib/mensetsu/service";

type Ctx = { params: Promise<{ pageId: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const guard = await requireActor();
  if (guard.res) return guard.res;
  const { pageId } = await ctx.params;
  const page = await prisma.interviewPrepPage.findUnique({ where: { id: pageId }, select: { id: true } });
  if (!page) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await resetVerifyFailures(pageId);
  const updated = await prisma.interviewPrepPage.findUniqueOrThrow({ where: { id: pageId }, include: PAGE_INCLUDE });
  return NextResponse.json({ page: toPageRow(updated) });
}
