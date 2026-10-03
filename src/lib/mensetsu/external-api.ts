// T-206: 外部 API（公開サイト向け）の共通部品。x-api-secret だけで判定し、ログイン確認の対象外。
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const EXTERNAL_NO_STORE = { "Cache-Control": "no-store" } as const;

export function checkMensetsuApiSecret(req: NextRequest): boolean {
  const expected = process.env.MENSETSU_API_SECRET;
  const given = req.headers.get("x-api-secret");
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
