import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getTokensFromCode } from "@/lib/googleCalendar";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(new URL("/?calendar_error=true", req.url));
  }

  // Use session to identify user (more secure than state param)
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.redirect(new URL("/?calendar_error=true", req.url));
  }

  try {
    const tokens = await getTokensFromCode(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      return NextResponse.redirect(new URL("/?calendar_error=true", req.url));
    }

    await prisma.googleCalendarConnection.upsert({
      where: { userId: user.id },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry: new Date(tokens.expiry_date || Date.now() + 3600 * 1000),
      },
      create: {
        userId: user.id,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry: new Date(tokens.expiry_date || Date.now() + 3600 * 1000),
        calendarId: "primary",
      },
    });

    return NextResponse.redirect(new URL("/?calendar_connected=true", req.url));
  } catch (e) {
    console.error("Google Calendar callback error:", e);
    return NextResponse.redirect(new URL("/?calendar_error=true", req.url));
  }
}
