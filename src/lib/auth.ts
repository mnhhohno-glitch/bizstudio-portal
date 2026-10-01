// T-XXX step5A: ログインセッション（bs_session Cookie）の正本。
//
// 旧方式: Cookie の中身が User.id そのもの（署名なし）→ ID を知られるとその人としてログインできた。
// 新方式: Cookie の中身は推測できない乱数トークン（src/lib/session-token.ts の形式）。サーバー側の user_sessions に
//         その SHA-256 だけを保存し、失効（revoked_at）・期限（expires_at）・ユーザーの status を毎回確かめる。
//   - 旧形式の Cookie は形式判定で落とす（受け付けない）。本番反映後は全員がログインし直しになる。
//   - ログアウトはそのセッションを失効させる。ユーザー無効化は revokeAllUserSessions で全セッションを失効させる。
//   - last_used_at は 10 分に 1 回だけ更新する（getSessionUser は 1 リクエストで何度も呼ばれるため毎回は書かない）。
//   - トークン・ハッシュ・Cookie の値はログに出さない。
//
// Cookie 以外の認証（x-api-secret / x-api-key / Bearer AI_READ_API_KEY / /api/mcp/[secret] / AppSession の Bearer）は
// このファイルを通らないので影響を受けない。

import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME, SESSION_TOKEN_PREFIX, isSessionTokenFormat } from "@/lib/session-token";

/** セッションの有効期間（作成からの絶対期限・延長しない）。旧方式の Cookie maxAge と同じ 7 日。 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** last_used_at を書き直す間隔。 */
const LAST_USED_REFRESH_MS = 10 * 60 * 1000;
/** 期限切れから何日経ったセッション行を掃除するか（ログイン時に実行）。 */
const EXPIRED_ROW_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionRevokeReason = "logout" | "user_disabled" | "replaced";

function cookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

/** 平文トークンを DB 保存用のハッシュにする（SHA-256 hex）。 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 新しい平文トークンを作る（32 バイトの乱数・base64url 43 文字）。 */
export function generateSessionToken(): string {
  return SESSION_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/**
 * セッション行を作って平文トークンを返す（Cookie は呼び出し側で設定）。
 * ログイン以外から呼ばない。
 */
export async function createSession(userId: string, now: Date = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await prisma.userSession.create({
    data: { userId, tokenHash: hashSessionToken(token), expiresAt, createdAt: now, lastUsedAt: now },
  });
  return { token, expiresAt };
}

/**
 * ログイン: セッション行を作り、bs_session Cookie に平文トークンを入れる。
 * 期限切れから 30 日以上経った行はここで掃除する（失敗しても無視）。
 */
export async function loginAndSetSessionCookie(userId: string): Promise<void> {
  const now = new Date();
  const { token } = await createSession(userId, now);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, cookieOptions(Math.floor(SESSION_TTL_MS / 1000)));
  try {
    await prisma.userSession.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - EXPIRED_ROW_RETENTION_MS) } } });
  } catch {
    // 掃除の失敗でログインを止めない
  }
}

/** 旧 API 名の互換（呼び出し側は loginAndSetSessionCookie を使うこと）。 */
export const setSessionUserId = loginAndSetSessionCookie;

/**
 * ログアウト: 今の Cookie のセッションを失効させ、Cookie を消す。
 * Cookie が無い・形式が違う（旧形式）ときは Cookie を消すだけ。
 */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE_NAME)?.value;
  if (isSessionTokenFormat(value)) {
    try {
      await prisma.userSession.updateMany({
        where: { tokenHash: hashSessionToken(value), revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "logout" },
      });
    } catch {
      // 失効の失敗でも Cookie は消す（次のリクエストで DB 側が期限切れになるまでは残るが、Cookie が無いので使えない）
    }
  }
  store.set(SESSION_COOKIE_NAME, "", cookieOptions(0));
}

/**
 * ユーザーの有効なセッションをすべて失効させる（ユーザー無効化・退職処理などから呼ぶ）。失効させた件数を返す。
 */
export async function revokeAllUserSessions(userId: string, reason: SessionRevokeReason): Promise<number> {
  const r = await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
  return r.count;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  status: "active" | "disabled";
}

/**
 * 今のリクエストのログインユーザー。未ログイン・旧形式 Cookie・失効・期限切れ・ユーザー無効のときは null。
 * 戻り値の形は旧実装（id / name / email / role / status）と同じ。
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE_NAME)?.value;
  if (!isSessionTokenFormat(value)) return null;

  const now = new Date();
  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashSessionToken(value) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      user: { select: { id: true, name: true, email: true, role: true, status: true } },
    },
  });
  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  const user = session.user;
  if (!user || user.status !== "active") return null;

  if (now.getTime() - session.lastUsedAt.getTime() > LAST_USED_REFRESH_MS) {
    try {
      await prisma.userSession.updateMany({ where: { id: session.id }, data: { lastUsedAt: now } });
    } catch {
      // 最終利用日時の更新失敗は認証結果に影響させない
    }
  }
  return user;
}
