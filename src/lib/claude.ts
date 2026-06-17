import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Claude モデルID は退役するため、直書きせずここに集約する（次の退役時はここ1箇所を変更）。
// 用途別に別モデル（例: 抽出系を Haiku に）へ分けたい場合はここに定数を追加する。
export const CLAUDE_MODEL_DEFAULT = "claude-sonnet-4-6";

export { anthropic };
