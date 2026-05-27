import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { createCalendarEvent, updateCalendarEvent } from "@/lib/googleCalendar";

type Slot = "first" | "second" | "final";

const SLOT_LABEL: Record<Slot, string> = {
  first: "一次面接",
  second: "二次面接",
  final: "最終面接",
};

function isSlot(v: unknown): v is Slot {
  return v === "first" || v === "second" || v === "final";
}

// JST 9時間ずれ罠回避: toLocaleDateString('sv-SE') 経由で YYYY-MM-DD 化
function toJstDateString(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}


export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { entryId } = await params;
  let body: { slot?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const slot = body.slot;
  if (!isSlot(slot)) {
    return NextResponse.json(
      { error: "slot must be 'first' | 'second' | 'final'" },
      { status: 400 }
    );
  }

  const connection = await prisma.googleCalendarConnection.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!connection) {
    return NextResponse.json({ skipped: true, reason: "not_connected" });
  }

  const entry = await prisma.jobEntry.findUnique({
    where: { id: entryId },
    include: {
      candidate: { select: { id: true, name: true, candidateNumber: true } },
    },
  });
  if (!entry) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const dateCol =
    slot === "first"
      ? entry.firstInterviewDate
      : slot === "second"
        ? entry.secondInterviewDate
        : entry.finalInterviewDate;
  const timeCol =
    slot === "first"
      ? entry.firstInterviewTime
      : slot === "second"
        ? entry.secondInterviewTime
        : entry.finalInterviewTime;
  const gcalId =
    slot === "first"
      ? entry.firstInterviewGcalId
      : slot === "second"
        ? entry.secondInterviewGcalId
        : entry.finalInterviewGcalId;

  if (!dateCol || !timeCol || !/^\d{1,2}:\d{2}$/.test(timeCol)) {
    return NextResponse.json({ skipped: true, reason: "incomplete" });
  }

  const dateStr = toJstDateString(dateCol);
  const startTime = timeCol.length === 4 ? `0${timeCol}` : timeCol; // "9:30" -> "09:30"
  const summary = `[${SLOT_LABEL[slot]}] ${entry.candidate.name} / ${entry.companyName}｜${startTime}〜`;

  let eventId: string | null = null;
  let action: "created" | "updated";

  if (gcalId) {
    await updateCalendarEvent(user.id, gcalId, dateStr, {
      summary,
      startTime,
      endTime: startTime,
      allDay: true,
    });
    eventId = gcalId;
    action = "updated";
  } else {
    eventId = await createCalendarEvent(user.id, dateStr, {
      summary,
      startTime,
      endTime: startTime,
      allDay: true,
    });
    if (!eventId) {
      return NextResponse.json(
        { success: false, error: "calendar_error" },
        { status: 500 }
      );
    }
    const updateData =
      slot === "first"
        ? { firstInterviewGcalId: eventId }
        : slot === "second"
          ? { secondInterviewGcalId: eventId }
          : { finalInterviewGcalId: eventId };
    await prisma.jobEntry.update({
      where: { id: entryId },
      data: updateData,
    });
    action = "created";
  }

  return NextResponse.json({ success: true, eventId, action });
}

export const dynamic = "force-dynamic";
