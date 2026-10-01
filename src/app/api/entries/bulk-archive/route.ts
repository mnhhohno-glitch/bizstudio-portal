import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
// T-XXX step5B: アーカイブ（archived_at の付与）を選考ステータスの変更として同じトランザクションで記録する
import { ENTRY_STATUS_SELECT, ENTRY_STATUS_ROUTES, recordJobEntryStatusUpdates } from "@/lib/entry-status-history";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const { entryIds } = body as { entryIds?: string[] };

  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    return NextResponse.json({ error: "entryIds is required" }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.jobEntry.findMany({ where: { id: { in: entryIds } }, select: ENTRY_STATUS_SELECT });
    const r = await tx.jobEntry.updateMany({
      where: { id: { in: entryIds } },
      data: { archivedAt: new Date() },
    });
    const after = await tx.jobEntry.findMany({ where: { id: { in: entryIds } }, select: ENTRY_STATUS_SELECT });
    await recordJobEntryStatusUpdates(tx, { before, after, changedByUserId: user.id, route: ENTRY_STATUS_ROUTES.bulkArchive });
    return r;
  });

  return NextResponse.json({ archived: result.count });
}
