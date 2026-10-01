/**
 * T-XXX step3: MCP 入口の秘密照合（src/lib/mcp/secret.ts）と回数制限（src/lib/mcp/rateLimit.ts）の純粋関数テスト。
 * DB・ネットワーク不要。実行: npx tsx scripts/test-mcp-secret-rate-limit-t-xxx-step3.ts
 */

import { isValidMcpSecret, MCP_SECRET_MIN_LENGTH } from "../src/lib/mcp/secret";
import { takeRateLimitToken, type RateLimitState } from "../src/lib/mcp/rateLimit";

let failures = 0;
let checks = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : `: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`}`);
}

const good = "a".repeat(MCP_SECRET_MIN_LENGTH) + "0123456789ABCDEF"; // 48 文字

// 秘密照合
check("未設定 → false", isValidMcpSecret(good, undefined), false);
check("空 → false", isValidMcpSecret(good, ""), false);
check("短すぎる設定値 → false（候補が一致していても）", isValidMcpSecret("short", "short"), false);
check("候補なし → false", isValidMcpSecret(undefined, good), false);
check("候補が空 → false", isValidMcpSecret("", good), false);
check("不一致（同じ長さ）→ false", isValidMcpSecret(good.slice(0, -1) + "X", good), false);
check("不一致（長さ違い）→ false", isValidMcpSecret(good + "1", good), false);
check("前方一致だけ → false", isValidMcpSecret(good.slice(0, 40), good), false);
check("一致 → true", isValidMcpSecret(good, good), true);

// 回数制限（固定窓 60 秒・60 回）
const st: RateLimitState = { windowStart: 0, count: 0 };
const t0 = 1_000_000;
let allowed = 0;
for (let i = 0; i < 60; i++) if (takeRateLimitToken(st, t0 + i * 100).allowed) allowed += 1;
check("最初の 60 回は許可", allowed, 60);
const d61 = takeRateLimitToken(st, t0 + 6_000);
check("61 回目は拒否", d61.allowed, false);
check("61 回目の Retry-After は残り秒（54）", d61.retryAfterSec, 54);
check("窓の最後でも拒否", takeRateLimitToken(st, t0 + 59_999).allowed, false);
const dNext = takeRateLimitToken(st, t0 + 60_000);
check("60 秒経つと新しい窓で許可", dNext.allowed, true);
check("新しい窓の残りは 59", dNext.remaining, 59);

console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${checks - failures}/${checks} checks`);
process.exitCode = failures === 0 ? 0 : 1;

export {};
