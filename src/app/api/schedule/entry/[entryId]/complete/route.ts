import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { entryId } = await params;
  const body = await req.json();
  const { isCompleted } = body as { isCompleted: boolean };

  const entry = await prisma.scheduleEntry.findUnique({
    where: { id: entryId },
    include: { dailySchedule: { select: { userId: true } } },
  });

  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (entry.dailySchedule.userId !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  // T-091: 日報タブから作成された DailySchedule は status="DRAFT" のまま完了チェックする運用に変更。
  // 以前の "CONFIRMED のみ許可" ガードは日報の完了 PATCH を 400 で弾き、楽観更新が DB と不整合になっていた。
  // 権限（userId 一致）は維持。SchedulePanel 由来の CONFIRMED ワークフローも従来どおり動作する。

  const updated = await prisma.scheduleEntry.update({
    where: { id: entryId },
    data: {
      isCompleted,
      completedAt: isCompleted ? new Date() : null,
    },
  });

  return NextResponse.json({ id: updated.id, isCompleted: updated.isCompleted, completedAt: updated.completedAt });
}
