// T-XXX step3: MCP 入口の簡易な回数制限（プロセス内・固定窓）。
//
// - 入口は ChatGPT という単一のクライアント向けなので、送信元ごとではなく入口全体で数える（1 分 60 回・超過は 429）。
// - Railway のコンテナ 1 台のメモリ上で数える。複数台にスケールすると台数分ゆるくなるが、目的は暴走・総当たりの抑止なので十分。
// - 純粋関数にして scripts からテストできるようにしている（now を外から渡せる）。

export const MCP_RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 60,
} as const;

export interface RateLimitState {
  windowStart: number;
  count: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** 429 の Retry-After（秒）。allowed のときは 0 */
  retryAfterSec: number;
  /** この窓での残り回数（allowed のときの参考値） */
  remaining: number;
}

/** state を更新しつつ判定する。state は呼び出し側が保持する（モジュール変数）。 */
export function takeRateLimitToken(
  state: RateLimitState,
  now: number,
  limit: { windowMs: number; maxRequests: number } = MCP_RATE_LIMIT,
): RateLimitDecision {
  if (now - state.windowStart >= limit.windowMs) {
    state.windowStart = now;
    state.count = 0;
  }
  if (state.count >= limit.maxRequests) {
    const retryAfterMs = limit.windowMs - (now - state.windowStart);
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)), remaining: 0 };
  }
  state.count += 1;
  return { allowed: true, retryAfterSec: 0, remaining: limit.maxRequests - state.count };
}

// 入口全体で 1 つの窓。Next.js はモジュールをプロセス内で 1 回だけ評価するので、ここがプロセス内の共有状態になる。
const mcpState: RateLimitState = { windowStart: 0, count: 0 };

export function takeMcpRateLimitToken(now: number = Date.now()): RateLimitDecision {
  return takeRateLimitToken(mcpState, now);
}
