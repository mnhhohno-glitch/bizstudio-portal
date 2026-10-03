// T-206: 延長。expiresAt を「今日（JST）＋30日の 0:00 JST」にする（下書きには使えない）
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { expiresAtFrom } from "@/lib/mensetsu/dates";
import { badRequest, requireActor } from "@/lib/mensetsu/internal-api";
import { PAGE_INCLUDE, todayYmd, toPageRow } from "@/lib/mensetsu/service";

type Ctx = { params: Promise<{ pageId: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const guard = await requireActor();
  if (guard.res) return guard.res;
  const { pageId } = await ctx.params;
  const page = await prisma.interviewPrepPage.findUnique({ where: { id: pageId }, select: { id: true, status: true } });
  if (!page) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (page.status === "draft") return badRequest("not_published", "下書きは延長できません（先に公開してください）");

  const now = new Date();
  const updated = await prisma.interviewPrepPage.update({
    where: { id: pageId },
    data: { expiresAt: expiresAtFrom(todayYmd(now)) },
    include: PAGE_INCLUDE,
  });
  return NextResponse.json({ page: toPageRow(updated, now) });
}
