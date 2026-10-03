// T-206: 本人確認トークン。記録の id と発行時刻を MENSETSU_TOKEN_SECRET で HMAC-SHA256 署名したもの。DB には保存しない。
//   形式: "{pageId}.{issuedAtMs}.{signature(base64url)}"
//   - ほかの記録のトークンでは通らない（pageId を照合）
//   - 発行から 90 日を過ぎたトークンは無効（Cookie の期限だけに頼らない）
import { createHmac, timingSafeEqual } from "node:crypto";
import { VIEWER_TOKEN_MAX_AGE_SECONDS } from "./constants";

function secret(): string | null {
  const s = process.env.MENSETSU_TOKEN_SECRET;
  return s && s.length >= 16 ? s : null;
}

function sign(pageId: string, issuedAt: number, key: string): string {
  return createHmac("sha256", key).update(`${pageId}.${issuedAt}`).digest("base64url");
}

export function issueViewerToken(pageId: string, now: Date = new Date()): string {
  const key = secret();
  if (!key) throw new Error("MENSETSU_TOKEN_SECRET is not set");
  const issuedAt = now.getTime();
  return `${pageId}.${issuedAt}.${sign(pageId, issuedAt, key)}`;
}

/** トークンが「この記録」のもので、署名が正しく、90 日以内なら true */
export function verifyViewerToken(token: unknown, pageId: string, now: Date = new Date()): boolean {
  const key = secret();
  if (!key || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [tokenPageId, issuedAtStr, sig] = parts;
  if (tokenPageId !== pageId) return false;
  if (!/^\d{10,16}$/.test(issuedAtStr)) return false;
  const issuedAt = Number(issuedAtStr);
  const ageMs = now.getTime() - issuedAt;
  if (ageMs < -5 * 60 * 1000) return false; // 未来の発行時刻は不正
  if (ageMs > VIEWER_TOKEN_MAX_AGE_SECONDS * 1000) return false;
  const expected = sign(pageId, issuedAt, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
