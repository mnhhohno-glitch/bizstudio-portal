// T-206: 公開停止（公開中 → 停止）。body { reason? }
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, parseOptionalString, requireActor } from "@/lib/mensetsu/internal-api";
import { PAGE_INCLUDE, toPageRow } from "@/lib/mensetsu/service";

type Ctx = { params: Promise<{ pageId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requireActor();
  if (guard.res) return guard.res;
  const { pageId } = await ctx.params;
  const page = await prisma.interviewPrepPage.findUnique({ where: { id: pageId }, select: { id: true, status: true } });
  if (!page) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (page.status !== "published") return badRequest("not_published", "公開中の記録だけ停止できます");

  let reason: string | null = null;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    reason = parseOptionalString(body.reason);
  } catch {
    /* body 無しでもよい */
  }

  const now = new Date();
  const updated = await prisma.interviewPrepPage.update({
    where: { id: pageId },
    data: { status: "stopped", stoppedAt: now, stoppedReason: reason ?? "manual" },
    include: PAGE_INCLUDE,
  });
  return NextResponse.json({ page: toPageRow(updated, now) });
}
