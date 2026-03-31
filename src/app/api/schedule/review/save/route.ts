import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { createCalendarEvent } from "@/lib/googleCalendar";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const { todayScheduleId, review, tomorrowDate, tomorrowSummary, tomorrowEntries } = body as {
    todayScheduleId: string;
    review: string;
    tomorrowDate?: string;
    tomorrowSummary?: string;
    tomorrowEntries?: {
      startTime: string;
      endTime: string;
      title: string;
      note?: string | null;
      tag: string;
      tagColor: string;
      sortOrder: number;
    }[];
  };

  if (!todayScheduleId || !review) {
    return NextResponse.json({ error: "todayScheduleId and review are required" }, { status: 400 });
  }

  // Verify ownership
  const todaySchedule = await prisma.dailySchedule.findUnique({ where: { id: todayScheduleId } });
  if (!todaySchedule || todaySchedule.userId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Update today's schedule with review
      await tx.dailySchedule.update({
        where: { id: todayScheduleId },
        data: { review, reviewStatus: "COMPLETED" },
      });

      // Create/update tomorrow's schedule if entries provided
      if (tomorrowDate && tomorrowEntries && tomorrowEntries.length > 0) {
        const date = new Date(tomorrowDate + "T00:00:00.000Z");

        const existing = await tx.dailySchedule.findUnique({
          where: { userId_date: { userId: user.id, date } },
        });

        if (existing) {
          await tx.scheduleEntry.deleteMany({ where: { dailyScheduleId: existing.id } });
          await tx.dailySchedule.update({
            where: { id: existing.id },
            data: { summary: tomorrowSummary || null },
          });
          await tx.scheduleEntry.createMany({
            data: tomorrowEntries.map((e) => ({
              dailyScheduleId: existing.id,
              startTime: e.startTime,
              endTime: e.endTime,
              title: e.title,
              note: e.note || null,
              tag: e.tag,
              tagColor: e.tagColor,
              entryType: "AI_GENERATED" as const,
              sortOrder: e.sortOrder,
            })),
          });
        } else {
          const created = await tx.dailySchedule.create({
            data: {
              userId: user.id,
              date,
              summary: tomorrowSummary || null,
            },
          });
          await tx.scheduleEntry.createMany({
            data: tomorrowEntries.map((e) => ({
              dailyScheduleId: created.id,
              startTime: e.startTime,
              endTime: e.endTime,
              title: e.title,
              note: e.note || null,
              tag: e.tag,
              tagColor: e.tagColor,
              entryType: "AI_GENERATED" as const,
              sortOrder: e.sortOrder,
            })),
          });
        }
      }
    });

    // Sync tomorrow's entries to Google Calendar (best effort)
    if (tomorrowDate && tomorrowEntries && tomorrowEntries.length > 0) {
      const tomorrowSchedule = await prisma.dailySchedule.findUnique({
        where: { userId_date: { userId: user.id, date: new Date(tomorrowDate + "T00:00:00.000Z") } },
        include: { entries: { where: { calendarEventId: null }, select: { id: true, startTime: true, endTime: true, title: true, note: true } } },
      });
      if (tomorrowSchedule) {
        for (const entry of tomorrowSchedule.entries) {
          try {
            const eventId = await createCalendarEvent(user.id, tomorrowDate, {
              summary: entry.title,
              startTime: entry.startTime,
              endTime: entry.endTime,
              description: entry.note || undefined,
            });
            if (eventId) {
              await prisma.scheduleEntry.update({ where: { id: entry.id }, data: { calendarEventId: eventId } });
            }
            await new Promise((r) => setTimeout(r, 100));
          } catch (e) {
            console.error(`[GCal] Review sync failed for ${entry.title}:`, e);
          }
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Review save error:", e);
    return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
  }
}
