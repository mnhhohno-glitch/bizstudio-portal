import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;

  const existing = await prisma.dailySchedule.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.userId !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const { summary, status, entries } = body as {
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

  const schedule = await prisma.$transaction(async (tx) => {
    await tx.dailySchedule.update({
      where: { id },
      data: {
        summary: summary !== undefined ? summary : existing.summary,
        status: status ? (status as "DRAFT" | "CONFIRMED" | "COMPLETED") : undefined,
      },
    });

    if (entries) {
      // Preserve isCompleted/completedAt by matching startTime + title
      const oldEntries = await tx.scheduleEntry.findMany({
        where: { dailyScheduleId: id },
        select: { startTime: true, title: true, isCompleted: true, completedAt: true },
      });
      const completionMap = new Map(
        oldEntries.map((e) => [`${e.startTime}|${e.title}`, { isCompleted: e.isCompleted, completedAt: e.completedAt }])
      );

      await tx.scheduleEntry.deleteMany({ where: { dailyScheduleId: id } });
      if (entries.length > 0) {
        await tx.scheduleEntry.createMany({
          data: entries.map((e) => {
            const prev = completionMap.get(`${e.startTime}|${e.title}`);
            return {
              dailyScheduleId: id,
              startTime: e.startTime,
              endTime: e.endTime,
              title: e.title,
              note: e.note || null,
              tag: e.tag,
              tagColor: e.tagColor,
              entryType: (e.entryType as "MANUAL" | "CALENDAR_SYNC" | "AI_GENERATED") || "MANUAL",
              sortOrder: e.sortOrder,
              isCompleted: prev?.isCompleted ?? false,
              completedAt: prev?.completedAt ?? null,
            };
          }),
        });
      }
    }

    return tx.dailySchedule.findUnique({
      where: { id },
      include: { entries: { orderBy: { sortOrder: "asc" } } },
    });
  });

  return NextResponse.json({ schedule });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;

  const existing = await prisma.dailySchedule.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.userId !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await prisma.dailySchedule.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
