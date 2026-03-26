import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;

  const schedule = await prisma.dailySchedule.findUnique({
    where: { id },
    select: { userId: true },
  });

  if (!schedule) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (schedule.userId !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const chatHistory = await prisma.scheduleChat.findMany({
    where: { dailyScheduleId: id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ chatHistory });
}
