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

    // T-167: refresh_token の空文字保存を防ぐ。
    //   Google は再認証時に refresh_token を返さないことがある。空文字で作成・上書きすると
    //   次回のリフレッシュが必ず失敗し、接続が失われる。
    //   - 既存レコードがあり refresh_token が無い → 既存の refreshToken を温存する（update から落とす）
    //   - 既存レコードが無い / 既存も空 → レコードを作らずエラーとして再試行を促す
    const existing = await prisma.googleCalendarConnection.findUnique({
      where: { userId },
      select: { refreshToken: true },
    });
    const usableExistingRefreshToken = Boolean(existing?.refreshToken?.trim());

    if (!tokens.refresh_token && !usableExistingRefreshToken) {
      console.error(
        `[GCal] Calendar callback: no refresh_token returned and no usable stored token. userId=${userId} hasExistingRow=${Boolean(existing)}`
      );
      return NextResponse.redirect(`${appUrl}/?calendar_error=no_refresh_token`);
    }

    const tokenExpiry = new Date(tokens.expiry_date || Date.now() + 3600000);

    await prisma.googleCalendarConnection.upsert({
      where: { userId },
      create: {
        userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token!, // 上のガードにより新規作成時は必ず存在する
        tokenExpiry,
        calendarId: "primary",
      },
      update: {
        accessToken: tokens.access_token,
        // refresh_token が返らなかった場合はフィールドごと落として既存値を温存する
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        tokenExpiry,
      },
    });

    return NextResponse.redirect(`${appUrl}/?calendar_connected=true`);
  } catch (error) {
    console.error("Calendar callback error:", error);
    return NextResponse.redirect(`${appUrl}/?calendar_error=true`);
  }
}
