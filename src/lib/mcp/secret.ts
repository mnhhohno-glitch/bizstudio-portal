// T-XXX step3: MCP 入口（/api/mcp/[secret]）の秘密URL照合。
//
// - 環境変数 MCP_PATH_SECRET とパスの [secret] を定数時間比較する。
// - 未設定・空・短すぎ・不一致はすべて false（呼び出し側は 404 にして入口の存在を知らせない）。
// - この関数は一切ログを吐かない。秘密の値を返り値・例外に含めない。

import { timingSafeEqual } from "node:crypto";

/** 設定値として受け付ける最短の長さ。短い値を設定してしまった事故（例 "test"）を本番で有効にしない。 */
export const MCP_SECRET_MIN_LENGTH = 32;

/** 長さ違いでも例外を投げず false を返す定数時間比較（src/lib/aiRead/auth.ts と同じ方針）。 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * パスで受け取った候補が、設定された秘密と一致するか。
 * @param candidate URL の [secret] 部分（デコード済み）
 * @param expected  process.env.MCP_PATH_SECRET（undefined / 空を含む）
 */
export function isValidMcpSecret(candidate: string | undefined | null, expected: string | undefined | null): boolean {
  if (!expected || expected.length < MCP_SECRET_MIN_LENGTH) return false;
  if (!candidate) return false;
  return safeEqual(candidate, expected);
}
