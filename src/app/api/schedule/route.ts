import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get("date");
  if (!dateStr) {
    return NextResponse.json({ error: "date parameter is required" }, { status: 400 });
  }

  const date = new Date(dateStr + "T00:00:00.000Z");

  const schedule = await prisma.dailySchedule.findUnique({
    where: { userId_date: { userId: user.id, date } },
    include: {
      entries: { orderBy: { sortOrder: "asc" } },
    },
  });

  return NextResponse.json({ schedule: schedule || null });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const { date: dateStr, summary, status, entries } = body as {
    date: string;
    summary?: string;
    status?: string;
    entries?: {
      startTime: string;
      endTime: string;
      title: string;
      note?: string;
      tag: string;
      tagColor: string;
      entryType?: string;
      sortOrder: number;
    }[];
  };

  if (!dateStr) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }

  const date = new Date(dateStr + "T00:00:00.000Z");

  // Check for existing
  const existing = await prisma.dailySchedule.findUnique({
    where: { userId_date: { userId: user.id, date } },
  });
  if (existing) {
    return NextResponse.json({ error: "この日のスケジュールは既に存在します" }, { status: 409 });
  }

  const schedule = await prisma.$transaction(async (tx) => {
    const created = await tx.dailySchedule.create({
      data: {
        userId: user.id,
        date,
        summary: summary || null,
        status: (status as "DRAFT" | "CONFIRMED" | "COMPLETED") || "DRAFT",
      },
    });

    if (entries && entries.length > 0) {
      await tx.scheduleEntry.createMany({
        data: entries.map((e) => ({
          dailyScheduleId: created.id,
          startTime: e.startTime,
          endTime: e.endTime,
          title: e.title,
          note: e.note || null,
          tag: e.tag,
          tagColor: e.tagColor,
          entryType: (e.entryType as "MANUAL" | "CALENDAR_SYNC" | "AI_GENERATED") || "MANUAL",
          sortOrder: e.sortOrder,
        })),
      });
    }

    return tx.dailySchedule.findUnique({
      where: { id: created.id },
      include: { entries: { orderBy: { sortOrder: "asc" } } },
    });
  });

  return NextResponse.json({ schedule }, { status: 201 });
}
