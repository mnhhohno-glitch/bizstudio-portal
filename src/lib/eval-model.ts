// T-XXX: 求人評価（手動 analyze-batch・自動配信の評価）のモデルと送り方の単一ソース。
//
// Railway の環境変数で切り替える（再デプロイ不要・再起動で反映）:
//   EVAL_MODEL  … 既定 claude-opus-5-5。claude-opus-4-6 にすると従来どおり（temperature 0.7・思考なし）で動く
//   EVAL_EFFORT … 既定 low。Opus 5.5 など effort 方式のモデルにだけ送る（low / medium / high / xhigh / max）
//
// モデルごとに送るパラメータを分ける理由:
//   - Opus 4.6 は temperature を受け付け、thinking 未指定＝思考なし（従来の本番設定）。
//   - Opus 5.5 は temperature と thinking の無効化を 400 で拒否する（常に adaptive thinking）。
//     考える量は output_config.effort で決める。応答の先頭に thinking ブロックが来るため、
//     読み取り側は text ブロックだけを連結する（evalResponseText）。
// 評価以外（AIアドバイザーのチャット等）のモデルはここでは扱わない（src/lib/claude.ts）。

export const EVAL_MODEL_OPUS_46 = "claude-opus-4-6";
export const EVAL_MODEL_OPUS_55 = "claude-opus-5-5";

const DEFAULT_EVAL_MODEL = EVAL_MODEL_OPUS_55;
// T-XXX step4 の答え合わせ（実際の書類選考結果）で決めた設定。
const DEFAULT_EVAL_EFFORT = "low";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type EvalEffort = (typeof EFFORTS)[number];

// temperature を送り thinking を送らない従来方式のモデル。
const LEGACY_SAMPLING_MODELS = new Set([EVAL_MODEL_OPUS_46]);

// Opus 4.6 は従来値。Opus 5.5 は考える工程も出力に含まれるため、
// step4 実測の1リクエスト最大出力（本文＋思考）に対して十分な余裕を取る（根拠は報告書）。
const MAX_TOKENS_LEGACY = 16000;
const MAX_TOKENS_EFFORT = 32000;

export type EvalRequestParams = {
  model: string;
  max_tokens: number;
  temperature?: number;
  output_config?: { effort: EvalEffort };
};

export function getEvalModel(): string {
  return process.env.EVAL_MODEL?.trim() || DEFAULT_EVAL_MODEL;
}

function getEvalEffort(): EvalEffort {
  const v = process.env.EVAL_EFFORT?.trim() as EvalEffort | undefined;
  return v && EFFORTS.includes(v) ? v : DEFAULT_EVAL_EFFORT;
}

/** Messages API（同期・Batch 共通）に載せるモデル関連パラメータ。system / messages は呼び出し側で足す。 */
export function evalRequestParams(): EvalRequestParams {
  const model = getEvalModel();
  if (LEGACY_SAMPLING_MODELS.has(model)) {
    return { model, max_tokens: MAX_TOKENS_LEGACY, temperature: 0.7 };
  }
  return { model, max_tokens: MAX_TOKENS_EFFORT, output_config: { effort: getEvalEffort() } };
}

/** 応答本文。thinking ブロックを飛ばし、text ブロックだけを連結する（Opus 4.6 では content[0].text と同じ）。 */
export function evalResponseText(content: { type: string; text?: string }[] | null | undefined): string {
  return (content ?? []).map((b) => (b.type === "text" ? b.text ?? "" : "")).join("");
}
