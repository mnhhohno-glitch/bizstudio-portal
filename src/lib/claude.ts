import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Claude モデルID は退役するため、直書きせずここに集約する（次の退役時はここ1箇所を変更）。
// 用途別に別モデル（例: 抽出系を Haiku に）へ分けたい場合はここに定数を追加する。
export const CLAUDE_MODEL_DEFAULT = "claude-sonnet-4-6";
// 求人分析用: 業務価値そのものなので Opus を維持（コスト最適化はキャッシュ分離で行う）。
export const CLAUDE_MODEL_ANALYSIS = "claude-opus-4-6";
// 軽処理用（画像OCR等の定型抽出）: Haiku で十分。
export const CLAUDE_MODEL_LIGHT = "claude-haiku-4-5";

// T-126: モデル別の $/1M トークン単価。costUsd 算出の単一ソース。
// モデルIDをキーにするため、退役でモデルを差し替える際はここも更新する。
// input=非キャッシュ入力 / output=出力 / cacheRead=キャッシュ読取(入力の10%) / cacheWrite=5分キャッシュ書込(入力の1.25倍)。
export type ModelPricing = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export const MODEL_PRICING_PER_MTOK: Record<string, ModelPricing> = {
  [CLAUDE_MODEL_ANALYSIS]: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, // Opus 4.6
  [CLAUDE_MODEL_DEFAULT]: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, // Sonnet 4.6
  [CLAUDE_MODEL_LIGHT]: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }, // Haiku 4.5
};

export { anthropic };
