import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/invite",
  "/auth/callback",
  "/api",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname.startsWith(path));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 公開パスはスキップ
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // 静的ファイルはスキップ
  if (pathname.startsWith("/_next") || pathname.includes(".")) {
    return NextResponse.next();
  }

  // セッションCookieをチェック
  const sessionCookie = request.cookies.get("bs_session");
  if (sessionCookie?.value) {
    return NextResponse.next();
  }

  // 未認証の場合、ログインページにリダイレクト
  // 環境変数から本番URLを取得（Railway内部ではlocalhostになるため）
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
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
