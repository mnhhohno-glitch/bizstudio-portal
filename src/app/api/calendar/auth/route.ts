import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAuthUrl } from "@/lib/googleCalendar";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const authUrl = getAuthUrl(user.id);
  return NextResponse.json({ authUrl });
}
