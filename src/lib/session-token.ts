// T-XXX step5A: ログインセッションのトークン形式（middleware と src/lib/auth.ts の両方から使う）。
//
// このファイルは Node 固有の API を使わない（middleware は Edge ランタイムで動くため）。
// 乱数の生成・ハッシュは src/lib/auth.ts 側（Node）で行う。
//
// 形式: "bss_" + base64url 43 文字（32 バイト）。合計 47 文字。
//   - 旧形式（User.id＝cuid、例 "cm..." 25 文字）はこの形式に一致しないので、middleware・getSessionUser の両方で拒否される。
//   - 形式に一致するだけでは認証にならない（DB の user_sessions にハッシュがあり、失効・期限切れでないことが条件）。

export const SESSION_COOKIE_NAME = "bs_session";
export const SESSION_TOKEN_PREFIX = "bss_";
/** トークン本体の base64url 文字数（32 バイト → 43 文字） */
export const SESSION_TOKEN_BODY_LENGTH = 43;

const SESSION_TOKEN_RE = new RegExp(`^${SESSION_TOKEN_PREFIX}[A-Za-z0-9_-]{${SESSION_TOKEN_BODY_LENGTH}}$`);

/** Cookie の値が新形式のセッショントークンの形をしているか（純粋関数・ログ無し）。 */
export function isSessionTokenFormat(value: string | null | undefined): value is string {
  return typeof value === "string" && SESSION_TOKEN_RE.test(value);
}
