import { redirect } from "next/navigation";
import jwt from "jsonwebtoken";
import { getSessionUser } from "@/lib/auth";

/**
 * GET /auth/sso?app=<appId>&callback=<url>
 *
 * 連携アプリ側から「まず portal でログインさせてほしい」と飛ばされてくる入口。
 * portal 側のセッション（bs_session）が無ければ middleware が /login?redirect=... に流すので、
 * このページに到達した時点でログイン済み。ここで短命 JWT を発行して callback に返す。
 *
 * 逆方向（portal サイドバー → 連携アプリ）は POST /api/auth/sso-token を使う。
 * 署名鍵・ペイロードは両者で同一（PORTAL_SSO_SECRET / userId・email・name / 5分）。
 */

// callback として許可するオリジン。ここに無いオリジンにはトークンを渡さない（オープンリダイレクト防止）。
function allowedOrigins(appId: string): string[] {
  const registry: Record<string, (string | undefined)[]> = {
    finance: [
      process.env.NEXT_PUBLIC_FINANCE_URL ||
        "https://bizstudio-finance-production.up.railway.app",
    ],
  };
  const urls = registry[appId];
  if (!urls) return [];

  const origins: string[] = [];
  for (const u of urls) {
    if (!u) continue;
    try {
      origins.push(new URL(u).origin);
    } catch {
      // 不正な環境変数は無視する
    }
  }
  // 開発時のみ localhost を許可
  if (process.env.NODE_ENV !== "production") {
    origins.push("http://localhost:3000", "http://localhost:3001");
  }
  return origins;
}

function ErrorView({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-bold text-[#1F3864]">連携できませんでした</h1>
        <p className="mt-3 text-sm text-gray-600">{message}</p>
      </div>
    </div>
  );
}

export default async function SsoHandoffPage({
  searchParams,
}: {
  searchParams: Promise<{ app?: string; callback?: string }>;
}) {
  const { app, callback } = await searchParams;

  if (!app || !callback) {
    return <ErrorView message="app / callback パラメータが不足しています。" />;
  }

  let callbackUrl: URL;
  try {
    callbackUrl = new URL(callback);
  } catch {
    return <ErrorView message="callback の URL が不正です。" />;
  }

  const origins = allowedOrigins(app);
  if (!origins.includes(callbackUrl.origin)) {
    return (
      <ErrorView message={`連携先として許可されていない遷移先です（${app}）。`} />
    );
  }

  const user = await getSessionUser();
  if (!user) {
    // middleware が先に /login へ流すので通常ここには来ない
    redirect(`/login?redirect=${encodeURIComponent(`/auth/sso?app=${app}&callback=${callback}`)}`);
  }

  if (user.role !== "admin") {
    return (
      <ErrorView message="このシステムを利用する権限がありません（管理者のみ）。" />
    );
  }

  const secret = process.env.PORTAL_SSO_SECRET || "bizstudio-sso-shared-secret-key";
  const token = jwt.sign(
    { userId: user.id, email: user.email, name: user.name },
    secret,
    { expiresIn: "5m" }
  );

  callbackUrl.searchParams.set("token", token);
  redirect(callbackUrl.toString());
}
