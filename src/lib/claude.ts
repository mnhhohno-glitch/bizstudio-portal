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

export { anthropic };
