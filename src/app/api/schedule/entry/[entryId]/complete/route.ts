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
    include: { dailySchedule: { select: { userId: true, status: true } } },
  });

  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (entry.dailySchedule.userId !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (entry.dailySchedule.status !== "CONFIRMED") {
    return NextResponse.json({ error: "スケジュールが確定済みの場合のみ操作可能です" }, { status: 400 });
  }

  const updated = await prisma.scheduleEntry.update({
    where: { id: entryId },
    data: {
      isCompleted,
      completedAt: isCompleted ? new Date() : null,
    },
  });

  return NextResponse.json({ id: updated.id, isCompleted: updated.isCompleted, completedAt: updated.completedAt });
}
