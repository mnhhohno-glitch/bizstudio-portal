import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTokensFromCode } from "@/lib/googleCalendar";

export async function GET(request: NextRequest) {
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;

  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");

    if (!code || !state) {
      return NextResponse.redirect(`${appUrl}/?calendar_error=missing_params`);
    }

    const userId = state;

    const tokens = await getTokensFromCode(code);

    if (!tokens.access_token) {
      return NextResponse.redirect(`${appUrl}/?calendar_error=token_failed`);
    }

    await prisma.googleCalendarConnection.upsert({
      where: { userId },
      create: {
        userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || "",
        tokenExpiry: new Date(tokens.expiry_date || Date.now() + 3600000),
        calendarId: "primary",
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        tokenExpiry: new Date(tokens.expiry_date || Date.now() + 3600000),
      },
    });

    return NextResponse.redirect(`${appUrl}/?calendar_connected=true`);
  } catch (error) {
    console.error("Calendar callback error:", error);
    return NextResponse.redirect(`${appUrl}/?calendar_error=true`);
  }
}
