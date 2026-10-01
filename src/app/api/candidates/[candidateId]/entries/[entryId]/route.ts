import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";
// T-XXX step5B: 削除を選考ステータス履歴（event=delete）として同じトランザクションで記録する
import { ENTRY_STATUS_SELECT, ENTRY_STATUS_ROUTES, recordJobEntryStatusChange } from "@/lib/entry-status-history";

type RouteContext = {
  params: Promise<{ candidateId: string; entryId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId, entryId } = await context.params;

  const body = await request.json();
  const { entryDate } = body;

  if (!entryDate || isNaN(new Date(entryDate).getTime())) {
    return NextResponse.json(
      { error: "有効なエントリー日を指定してください" },
      { status: 400 }
    );
  }

  const entry = await prisma.jobEntry.findFirst({
    where: { id: entryId, candidateId },
  });
  if (!entry) {
    return NextResponse.json(
      { error: "エントリーが見つかりません" },
      { status: 404 }
    );
  }

  const updated = await prisma.jobEntry.update({
    where: { id: entryId },
    data: { entryDate: new Date(entryDate) },
  });

  return NextResponse.json({ entry: updated });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId, entryId } = await context.params;

  const entry = await prisma.jobEntry.findFirst({
    where: { id: entryId, candidateId },
  });
  if (!entry) {
    return NextResponse.json(
      { error: "エントリーが見つかりません" },
      { status: 404 }
    );
  }

  await prisma.$transaction(async (tx) => {
    const before = await tx.jobEntry.findUnique({ where: { id: entryId }, select: ENTRY_STATUS_SELECT });
    await tx.jobEntry.delete({ where: { id: entryId } });
    if (before) {
      await recordJobEntryStatusChange(tx, { event: "delete", before, after: null, changedByUserId: user.id, route: ENTRY_STATUS_ROUTES.entryDelete });
    }
  });

  try {
    await recalculateSubStatusIfAuto(candidateId, user.id);
  } catch (e) {
    console.error("[entries.DELETE] recalculateSubStatusIfAuto failed:", e);
  }

  return NextResponse.json({ message: "エントリーを削除しました" });
}
