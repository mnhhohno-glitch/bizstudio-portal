import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Claude モデルID は退役するため、直書きせずここに集約する（次の退役時はここ1箇所を変更）。
// 用途別に別モデル（例: 抽出系を Haiku に）へ分けたい場合はここに定数を追加する。
export const CLAUDE_MODEL_DEFAULT = "claude-sonnet-4-6";
// 求人評価の従来モデル（Opus 4.6）。T-XXX で評価は src/lib/eval-model.ts（EVAL_MODEL・既定 Opus 5.5）へ移った。
// この定数は評価の送信には使わない（検証スクリプトの比較用・料金表のキーとして残す）。
export const CLAUDE_MODEL_ANALYSIS = "claude-opus-4-6";
// 軽処理用（画像OCR等の定型抽出）: Haiku で十分。
export const CLAUDE_MODEL_LIGHT = "claude-haiku-4-5";
// T-183: 面談サポートのリアルタイム解説用（体感速度優先の最速モデル）。
export const CLAUDE_MODEL_FAST = "claude-haiku-4-5";

// T-126: モデル別の $/1M トークン単価。costUsd 算出の単一ソース。
// モデルIDをキーにするため、退役でモデルを差し替える際はここも更新する。
// input=非キャッシュ入力 / output=出力 / cacheRead=キャッシュ読取(入力の10%。Opus 5.5 は 5%) / cacheWrite=5分キャッシュ書込(入力の1.25倍)。
// 1時間キャッシュ書込（入力の2倍）とバッチ割引（×0.5）は advisor-usage.ts の computeCostUsd / recordAdvisorUsage で掛ける。
// 出力（output_tokens）は思考（thinking）の分を含んだ値で返るため、思考を別に足さない（二重計上になる）。
export type ModelPricing = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export const MODEL_PRICING_PER_MTOK: Record<string, ModelPricing> = {
  [CLAUDE_MODEL_ANALYSIS]: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, // Opus 4.6
  // T-XXX: 求人評価（EVAL_MODEL 既定）。公式料金 $4/$20・読込 $0.20（0.05x）・5分書込 $5・1時間書込 $8（2x）
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }, // Opus 5.5
  [CLAUDE_MODEL_DEFAULT]: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, // Sonnet 4.6
  [CLAUDE_MODEL_LIGHT]: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }, // Haiku 4.5
  // T-132: Gemini 診断抽出用（概算単価・Flash系の公表値ベース。preview のため目安）。
  // cacheRead/cacheWrite は未使用（Gemini はここでは非キャッシュ運用）。
  "gemini-3-flash-preview": { input: 0.3, output: 2.5, cacheRead: 0.075, cacheWrite: 0 },
};

export { anthropic };
