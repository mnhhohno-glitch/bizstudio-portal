import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // 求職者用ページ・APIは認証不要（最優先）
  if (
    pathname.startsWith("/g/") ||
    pathname.startsWith("/api/guides/") ||
    pathname.startsWith("/j/") ||
    pathname.startsWith("/api/jimu/")
  ) {
    return NextResponse.next();
  }

  // 公開パス
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/invite") ||
    pathname.startsWith("/auth/callback") ||
    pathname.startsWith("/api/")
  ) {
    return NextResponse.next();
  }

  // 静的ファイル
  if (pathname.startsWith("/_next") || pathname.includes(".")) {
    return NextResponse.next();
  }

  // セッションCookieチェック
  const sessionCookie = request.cookies.get("bs_session");
  if (sessionCookie?.value) {
    return NextResponse.next();
  }

  // 未認証 → ログインへリダイレクト
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const redirectUrl = `${appUrl}${pathname}${request.nextUrl.search}`;
  const loginUrl = new URL("/login", appUrl);
  loginUrl.searchParams.set("redirect", redirectUrl);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo.png).*)",
  ],
};
