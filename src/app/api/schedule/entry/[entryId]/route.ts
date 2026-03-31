import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { updateCalendarEvent, deleteCalendarEvent } from "@/lib/googleCalendar";

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

  // Sync to Google Calendar (best effort)
  if (entry.calendarEventId) {
    const schedule = await prisma.dailySchedule.findUnique({ where: { id: entry.dailyScheduleId }, select: { date: true } });
    if (schedule) {
      const dateStr = schedule.date.toISOString().slice(0, 10);
      await updateCalendarEvent(user.id, entry.calendarEventId, dateStr, {
        summary: title,
        startTime,
        endTime,
      });
    }
  }

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

  // Delete from Google Calendar (best effort)
  if (entry.calendarEventId) {
    await deleteCalendarEvent(user.id, entry.calendarEventId);
  }

  await prisma.scheduleEntry.delete({ where: { id: entryId } });

  return NextResponse.json({ success: true });
}
