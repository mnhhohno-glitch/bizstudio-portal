import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getTokensFromCode } from "@/lib/googleCalendar";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  // Build redirect base from APP_URL (Railway proxy-safe)
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;

  if (error || !code) {
    return NextResponse.redirect(`${appUrl}/?calendar_error=missing_params`);
  }

  // Try session first, fall back to state param (userId)
  let userId: string | null = null;
  const user = await getSessionUser();
  if (user) {
    userId = user.id;
  } else if (state) {
    userId = state;
  }

  if (!userId) {
    return NextResponse.redirect(`${appUrl}/?calendar_error=no_user`);
  }

  try {
    const tokens = await getTokensFromCode(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      console.error("Calendar callback: missing tokens", { hasAccess: !!tokens.access_token, hasRefresh: !!tokens.refresh_token });
      return NextResponse.redirect(`${appUrl}/?calendar_error=token_failed`);
    }

    await prisma.googleCalendarConnection.upsert({
      where: { userId },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry: new Date(tokens.expiry_date || Date.now() + 3600 * 1000),
      },
      create: {
        userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry: new Date(tokens.expiry_date || Date.now() + 3600 * 1000),
        calendarId: "primary",
      },
    });

    return NextResponse.redirect(`${appUrl}/?calendar_connected=true`);
  } catch (e) {
    console.error("Google Calendar callback error:", e);
    return NextResponse.redirect(`${appUrl}/?calendar_error=true`);
  }
}
