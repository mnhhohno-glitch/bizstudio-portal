import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
// T-XXX step5B: 完全削除を event=delete として同じトランザクションで記録する
import { ENTRY_STATUS_SELECT, ENTRY_STATUS_ROUTES, recordJobEntryStatusChanges } from "@/lib/entry-status-history";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "管理者権限が必要です" }, { status: 403 });
  }

  const body = await req.json();
  const { entryIds } = body as { entryIds?: string[] };

  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    return NextResponse.json({ error: "entryIds is required" }, { status: 400 });
  }

  // アーカイブ済みのレコードのみ削除可能
  const result = await prisma.$transaction(async (tx) => {
    const where = { id: { in: entryIds }, archivedAt: { not: null } };
    const before = await tx.jobEntry.findMany({ where, select: ENTRY_STATUS_SELECT });
    const r = await tx.jobEntry.deleteMany({ where });
    await recordJobEntryStatusChanges(
      tx,
      before.map((b) => ({ event: "delete" as const, before: b, after: null, changedByUserId: user.id, route: ENTRY_STATUS_ROUTES.bulkDelete })),
    );
    return r;
  });

  return NextResponse.json({ deleted: result.count });
}
