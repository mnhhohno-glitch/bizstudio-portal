// T-206: 公開 URL 末尾の slug（英大小文字＋数字 7 文字）。crypto.randomInt で生成し、衝突時は呼び出し側で作り直す。
import { randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const SLUG_LENGTH = 7;
export const SLUG_PATTERN = /^[A-Za-z0-9]{7}$/;

export function generateSlug(): string {
  let s = "";
  for (let i = 0; i < SLUG_LENGTH; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export function isValidSlug(v: unknown): v is string {
  return typeof v === "string" && SLUG_PATTERN.test(v);
}
