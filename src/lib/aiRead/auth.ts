// T-190: AI（Claude / ChatGPT）向け読み取り専用 API の Bearer 認証。
//
// - 環境変数 AI_READ_API_KEY と `Authorization: Bearer <key>` を timingSafeEqual で照合する。
// - 未設定・空文字なら 503（素通しは禁止）。ヘッダ無し・形式違い・不一致は理由を返さず 401。
// - 鍵の値はログに出さない（この関数は一切ログを吐かない）。

import { timingSafeEqual } from "node:crypto";

/** 長さ違いでも例外を投げず false を返す定数時間比較。 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual は長さ不一致で throw するため、先に長さで落とす（長さは秘密ではない）。
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * 認証NGなら Response（401 / 503）を返し、OK なら null を返す。
 * 呼び出し側は `const deny = assertAiReadAuth(req); if (deny) return deny;` の形で使う。
 */
export function assertAiReadAuth(req: Request): Response | null {
  const expected = process.env.AI_READ_API_KEY;
  if (!expected) {
    return Response.json({ error: "not_configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const header = req.headers.get("authorization");
  const unauthorized = Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
  if (!header) return unauthorized;

  // "Bearer <key>" のみ受け付ける（スキーム名は大文字小文字を区別しない）。
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return unauthorized;

  return safeEqual(m[1], expected) ? null : unauthorized;
}
