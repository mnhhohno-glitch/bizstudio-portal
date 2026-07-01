import { prisma } from "@/lib/prisma";
import { MODEL_PRICING_PER_MTOK } from "@/lib/claude";

// T-126: AIアドバイザー系 Anthropic API の usage を AdvisorUsageLog に永続化するヘルパ。
//
// 設計方針:
// - コスト算出はモデルIDをキーに MODEL_PRICING_PER_MTOK を参照（モデルIDのハードコード禁止）。
// - 未知モデルは costUsd=0 で記録し note に "unknown-model-pricing" を残す（記録欠損を防ぐ）。
// - 記録失敗が分析本体を落とさないよう、内部で try-catch し常に resolve する（呼び出し側は await 任意）。

/** Anthropic Messages API の usage オブジェクト（raw fetch / SDK 双方が snake_case で返す）。 */
export type AnthropicUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
} | null | undefined;

export type AdvisorEndpoint =
  | "analyze-batch"
  | "advisor-chat"
  | "greeting"
  | "daily-report-assist"
  | "daily-report-chat";

type TokenBreakdown = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

/** usage からトークン内訳を取り出す（欠損は 0）。 */
export function extractTokens(usage: AnthropicUsage): TokenBreakdown {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
  };
}

/** モデルIDとトークン内訳から USD コストを算出。未知モデルは { costUsd: 0, unknownPricing: true }。 */
export function computeCostUsd(
  model: string,
  t: TokenBreakdown
): { costUsd: number; unknownPricing: boolean } {
  const p = MODEL_PRICING_PER_MTOK[model];
  if (!p) return { costUsd: 0, unknownPricing: true };
  const costUsd =
    (t.inputTokens * p.input +
      t.outputTokens * p.output +
      t.cacheReadTokens * p.cacheRead +
      t.cacheCreationTokens * p.cacheWrite) /
    1_000_000;
  return { costUsd, unknownPricing: false };
}

export type RecordAdvisorUsageParams = {
  endpoint: AdvisorEndpoint;
  model: string;
  usage: AnthropicUsage;
  candidateId?: string | null;
  batchIndex?: number | null;
  batchTotal?: number | null;
  fileCount?: number | null;
  isRetry?: boolean;
  note?: string | null;
};

/**
 * 1コール分の usage を AdvisorUsageLog に保存する。
 * 失敗しても例外を投げない（分析本体から隔離）。呼び出し側は await してもしなくてもよい。
 */
export async function recordAdvisorUsage(params: RecordAdvisorUsageParams): Promise<void> {
  try {
    const tokens = extractTokens(params.usage);
    const { costUsd, unknownPricing } = computeCostUsd(params.model, tokens);
    const note = unknownPricing
      ? [params.note, "unknown-model-pricing"].filter(Boolean).join("; ")
      : params.note ?? null;

    await prisma.advisorUsageLog.create({
      data: {
        endpoint: params.endpoint,
        candidateId: params.candidateId ?? null,
        batchIndex: params.batchIndex ?? null,
        batchTotal: params.batchTotal ?? null,
        fileCount: params.fileCount ?? null,
        model: params.model,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        cacheReadTokens: tokens.cacheReadTokens,
        cacheCreationTokens: tokens.cacheCreationTokens,
        costUsd,
        isRetry: params.isRetry ?? false,
        note,
      },
    });
  } catch (e) {
    // 記録失敗は本体処理に影響させない（ログのみ）。
    console.error("[recordAdvisorUsage] failed to persist usage:", e);
  }
}
