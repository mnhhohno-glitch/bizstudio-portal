import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { createCalendarEvent } from "@/lib/googleCalendar";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const { scheduleId, startTime, endTime, title, note, tag, tagColor, entryType, sortOrder } = body as {
    scheduleId: string;
    startTime: string;
    endTime: string;
    title: string;
    note?: string;
    tag: string;
    tagColor: string;
    entryType?: string;
    sortOrder?: number;
  };

  if (!scheduleId || !startTime || !endTime || !title || !tag || !tagColor) {
    return NextResponse.json({ error: "必須フィールドが不足しています" }, { status: 400 });
  }

  const schedule = await prisma.dailySchedule.findUnique({ where: { id: scheduleId } });
  if (!schedule) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (schedule.userId !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const entry = await prisma.scheduleEntry.create({
    data: {
      dailyScheduleId: scheduleId,
      startTime,
      endTime,
      title,
      note: note || null,
      tag,
      tagColor,
      entryType: (entryType as "MANUAL" | "CALENDAR_SYNC" | "AI_GENERATED") || "MANUAL",
      sortOrder: sortOrder ?? 999,
      isCompleted: false,
    },
  });

  // Sync to Google Calendar (best effort)
  const dateStr = schedule.date.toISOString().slice(0, 10);
  const calendarEventId = await createCalendarEvent(user.id, dateStr, {
    summary: title,
    startTime,
    endTime,
    description: note || undefined,
  });
  if (calendarEventId) {
    await prisma.scheduleEntry.update({
      where: { id: entry.id },
      data: { calendarEventId },
    });
  }

  return NextResponse.json({ entry: { ...entry, calendarEventId } }, { status: 201 });
}
