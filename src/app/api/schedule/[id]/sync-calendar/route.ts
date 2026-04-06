import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { createCalendarEvent, updateCalendarEvent } from "@/lib/googleCalendar";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;

  const schedule = await prisma.dailySchedule.findUnique({
    where: { id },
    include: { entries: { orderBy: { startTime: "asc" } } },
  });

  if (!schedule) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (schedule.userId !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const dateStr = schedule.date.toISOString().slice(0, 10);
  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const entry of schedule.entries) {
    try {
      if (entry.calendarEventId) {
        // Update existing event
        await updateCalendarEvent(user.id, entry.calendarEventId, dateStr, {
          summary: entry.title,
          startTime: entry.startTime,
          endTime: entry.endTime,
        });
        updated++;
      } else {
        // Create new event
        const eventId = await createCalendarEvent(user.id, dateStr, {
          summary: entry.title,
          startTime: entry.startTime,
          endTime: entry.endTime,
          description: entry.note || undefined,
        });
        if (eventId) {
          await prisma.scheduleEntry.update({
            where: { id: entry.id },
            data: { calendarEventId: eventId },
          });
          created++;
        } else {
          errors++;
        }
      }
    } catch (e) {
      console.error(`[GCal Sync] Failed for entry ${entry.title}:`, e);
      errors++;
    }
    // Rate limit
    await new Promise((r) => setTimeout(r, 100));
  }

  return NextResponse.json({
    synced: created + updated,
    created,
    updated,
    errors,
  });
}
