import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getCalendarEvents } from "@/lib/googleCalendar";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  if (!date) {
    return NextResponse.json({ error: "date parameter is required" }, { status: 400 });
  }

  const connection = await prisma.googleCalendarConnection.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  if (!connection) {
    return NextResponse.json({ connected: false, events: [] });
  }

  try {
    const events = await getCalendarEvents(user.id, date);
    return NextResponse.json({ connected: true, events });
  } catch (e) {
    console.error("Calendar events error:", e);
    return NextResponse.json({ connected: true, events: [] });
  }
}
