// T-135 AI費用帳簿: モデル別単価表と費用算出の単一ソース。
//
// 全システム（portal / kyuujin / job-platform）の AI 使用量はここの単価で円換算する。
// モデル追加・単価改定はこのファイル1箇所だけを直せばよい。
//
// 出典: Gemini API 公式料金ページ https://ai.google.dev/gemini-api/docs/pricing
//       （2026-07-13 時点の Paid tier / text・image・video 系の単価を確認して転記）
//       Claude は src/lib/claude.ts の MODEL_PRICING_PER_MTOK と同じ値（Anthropic 公式）。
//
// 注意: audio 入力は Gemini 側で単価が別（例 2.5 Flash は $1.00/1M）。現状どのシステムも
//       audio を投げていないため text 系の単価のみを持つ。audio を使い始めたら要拡張。

/** USD → JPY の換算レート。改定はここ1箇所（2026-07 時点の概算レート）。 */
export const USD_TO_JPY = 160;

/** $/1Mトークン。cachedInput は暗黙/明示キャッシュのヒット分に適用される単価。 */
export type AiModelPricing = {
  /** 非キャッシュ入力 $/1Mtok */
  input: number;
  /** 出力 $/1Mtok */
  output: number;
  /** キャッシュヒット入力 $/1Mtok */
  cachedInput: number;
};

/**
 * モデルID → 単価。キーは各システムが API に投げている**実際のモデルID文字列**に合わせること。
 * ここに無いモデルは費用 null（＝未算出）で記録され、後から単価を足せば再計算できる。
 */
export const AI_MODEL_PRICING: Record<string, AiModelPricing> = {
  // --- Gemini（https://ai.google.dev/gemini-api/docs/pricing・2026-07-13 確認） ---
  // portal が現在使っている主力モデル。旧 claude.ts の値(0.3/2.5)は 2.5 Flash のものを流用した
  // 誤りで、3 Flash の実単価は input/output とも高い。ここが正。
  "gemini-3-flash-preview": { input: 0.5, output: 3.0, cachedInput: 0.05 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cachedInput: 0.03 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4, cachedInput: 0.01 },
  "gemini-2.5-pro": { input: 1.25, output: 10.0, cachedInput: 0.125 }, // ≤200k tok 時の単価
  // portal の一部ルート（ai-organize 等）が使っている旧モデル。
  "gemini-2.0-flash": { input: 0.1, output: 0.4, cachedInput: 0.025 },

  // --- Claude（Anthropic 公式・src/lib/claude.ts と同値） ---
  "claude-opus-4-6": { input: 5, output: 25, cachedInput: 0.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cachedInput: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cachedInput: 0.1 },
};

export type AiTokenCounts = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
};

/**
 * トークン数 → 推定費用（日本円）。単価表に無いモデルは null（未算出）を返す。
 *
 * inputTokens は「キャッシュヒット分を含まない純粋な入力」として扱う。Gemini の usageMetadata は
 * promptTokenCount にキャッシュ分も含むため、呼び出し側で cachedContentTokenCount を差し引いて渡すこと
 * （recordAiUsage 側で吸収している）。
 */
export function estimateCostJpy(model: string, tokens: AiTokenCounts): number | null {
  const p = AI_MODEL_PRICING[model];
  if (!p) return null;

  const input = tokens.inputTokens ?? 0;
  const output = tokens.outputTokens ?? 0;
  const cached = tokens.cachedInputTokens ?? 0;

  const usd =
    (input / 1_000_000) * p.input +
    (output / 1_000_000) * p.output +
    (cached / 1_000_000) * p.cachedInput;

  return usd * USD_TO_JPY;
}

/** 単価表に載っているモデルか（記録受け口のバリデーション用・未知でも記録は通す）。 */
export function isKnownModel(model: string): boolean {
  return model in AI_MODEL_PRICING;
}
