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

  const entry = await prisma.scheduleEntry.findUnique({
    where: { id: entryId },
    include: { dailySchedule: { select: { userId: true } } },
  });

  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (entry.dailySchedule.userId !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const { startTime, endTime, title, note, tag, tagColor } = body as {
    startTime?: string;
    endTime?: string;
    title?: string;
    note?: string;
    tag?: string;
    tagColor?: string;
  };

  const updated = await prisma.scheduleEntry.update({
    where: { id: entryId },
    data: {
      ...(startTime !== undefined && { startTime }),
      ...(endTime !== undefined && { endTime }),
      ...(title !== undefined && { title }),
      ...(note !== undefined && { note: note || null }),
      ...(tag !== undefined && { tag }),
      ...(tagColor !== undefined && { tagColor }),
    },
  });

  return NextResponse.json({ entry: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { entryId } = await params;

  const entry = await prisma.scheduleEntry.findUnique({
    where: { id: entryId },
    include: { dailySchedule: { select: { userId: true } } },
  });

  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (entry.dailySchedule.userId !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await prisma.scheduleEntry.delete({ where: { id: entryId } });

  return NextResponse.json({ success: true });
}
