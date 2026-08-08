// T-147: セキュアファイル送信の共通ユーティリティ。
// - パスワード生成 / URLトークン生成 / 有効期限計算（JST）/ 状態判定 / IP取得 / DL用JWT
// - パスワードの平文はDBに保存しない。生成 → bcryptハッシュ化 → メール送信と発行時の画面表示にのみ使う。

import crypto from "crypto";
import jwt from "jsonwebtoken";
import type { NextRequest } from "next/server";
import { generateToken } from "@/lib/encryption";

export const SECURE_TRANSFER_BUCKET = "secure-transfers";

// 1ファイル上限。Int32（fileSize カラム）と Supabase の制限を考慮して 1GB。
export const MAX_TRANSFER_FILE_SIZE = 1024 * 1024 * 1024;
export const MAX_TRANSFER_FILES = 10;

export const FAILED_ATTEMPTS_LIMIT = 10; // パスワード照合をこの回数失敗すると自動無効化

/** URLトークン（48バイト base64url = 64文字）。 */
export function generateTransferToken(): string {
  return generateToken("");
}

// パスワード: 12文字、英大小＋数字。紛らわしい文字（0/O/1/l/I）は除外（確定仕様）。
const PW_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // O, I を除外
const PW_LOWER = "abcdefghijkmnopqrstuvwxyz"; // l を除外
const PW_DIGIT = "23456789"; // 0, 1 を除外
const PW_ALL = PW_UPPER + PW_LOWER + PW_DIGIT;
const PASSWORD_LENGTH = 12;

/** 12文字パスワードを生成。英大・英小・数字を各1文字以上含むことを保証する。 */
export function generateTransferPassword(): string {
  const chars: string[] = [
    PW_UPPER[crypto.randomInt(PW_UPPER.length)],
    PW_LOWER[crypto.randomInt(PW_LOWER.length)],
    PW_DIGIT[crypto.randomInt(PW_DIGIT.length)],
  ];
  while (chars.length < PASSWORD_LENGTH) {
    chars.push(PW_ALL[crypto.randomInt(PW_ALL.length)]);
  }
  // Fisher-Yates（crypto.randomInt）でシャッフル
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// 有効期限計算・JST表示はプレビュー画面（クライアント）と共用のため secure-transfer-shared.ts に移動。
// 既存の import 先（このモジュール）を変えないよう再エクスポートする。
export { calcExpiresAt, formatJstDateTime } from "@/lib/secure-transfer-shared";

export type TransferStatus = "active" | "expired" | "revoked";

/** 状態判定。無効化（手動・自動とも revokedAt）を期限切れより優先して表示する。 */
export function getTransferStatus(t: { expiresAt: Date; revokedAt: Date | null }): TransferStatus {
  if (t.revokedAt) return "revoked";
  if (new Date() > t.expiresAt) return "expired"; // インスタント比較（TZ非依存）
  return "active";
}

/** 受信者がダウンロード可能か（verify 成功後の各APIで毎回確認する）。 */
export function isTransferAvailable(t: { expiresAt: Date; revokedAt: Date | null }): boolean {
  return getTransferStatus(t) === "active";
}

/** Railway はプロキシ配下のため x-forwarded-for の先頭がクライアントIP。 */
export function getClientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip");
}

// ---------------------------------------------------------------------------
// パスワード照合成功後のダウンロードアクセス用 JWT（既存 /api/share/ と同じ方式）。
// フォールバック文字列は置かない: PORTAL_SSO_SECRET 未設定は例外（fail-closed）。
// ---------------------------------------------------------------------------

function getShareSecret(): string {
  const secret = process.env.PORTAL_SSO_SECRET;
  if (!secret) {
    throw new Error("PORTAL_SSO_SECRET is not set");
  }
  return secret;
}

const ACCESS_TOKEN_TTL = "2h";
const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 2;

export function transferAccessCookieName(token: string): string {
  return `st_${token}`;
}

export function issueTransferAccessToken(token: string): { jwt: string; maxAge: number } {
  return {
    jwt: jwt.sign({ transferToken: token }, getShareSecret(), { expiresIn: ACCESS_TOKEN_TTL }),
    maxAge: ACCESS_COOKIE_MAX_AGE,
  };
}

export function verifyTransferAccessToken(accessToken: string, token: string): boolean {
  try {
    const payload = jwt.verify(accessToken, getShareSecret()) as { transferToken?: string };
    return payload.transferToken === token;
  } catch {
    return false;
  }
}
