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
  // T-189: TTL別のキャッシュ書込内訳（新しいレスポンス形式）。1h TTL の書込は
  // 5分TTL（input×1.25）ではなく input×2 で課金されるため、取れる場合はこちらで計上する。
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
} | null | undefined;

export type AdvisorEndpoint =
  | "analyze-batch"
  | "advisor-chat"
  | "greeting"
  | "daily-report-assist"
  | "daily-report-chat"
  | "diagnosis-extract" // T-132: 診断散文→希望条件の構造化抽出（Gemini）
  | "interview-task-detect" // T-151: 面談ログからのタスク約束検出（Anthropic）
  | "advisor-log-ingest" // T-155: 未読面談ログの取り込み・ダイジェスト統合（Anthropic）
  | "interview-support-explain" // T-183: 面談サポートのリアルタイム解説（Anthropic Haiku・ストリーミング）
  | "interview-support-auto-scan" // T-183 Phase 3: 面談サポートの自動検知（用語/業務内容/転職理由・非ストリーミング）
  | "interview-support-prior-keyterms"; // T-183 Phase 6: 事前情報からの固有名詞抽出（Deepgram Keyterm 用・画面起動時1回）

type TokenBreakdown = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  // T-189: TTL別のキャッシュ書込内訳。旧レスポンス形式（cache_creation 無し）では null のまま
  // ＝費用は従来どおり cacheCreationTokens × cacheWrite（5分TTL単価）で算出する。
  cacheCreation5mTokens: number | null;
  cacheCreation1hTokens: number | null;
};

/** usage からトークン内訳を取り出す（欠損は 0）。 */
export function extractTokens(usage: AnthropicUsage): TokenBreakdown {
  const breakdown = usage?.cache_creation;
  const hasBreakdown =
    breakdown != null &&
    (typeof breakdown.ephemeral_5m_input_tokens === "number" ||
      typeof breakdown.ephemeral_1h_input_tokens === "number");
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    // 合計値（cache_creation_input_tokens）が欠けている新形式にも備え、内訳から補完する。
    cacheCreationTokens:
      usage?.cache_creation_input_tokens ??
      (hasBreakdown
        ? (breakdown.ephemeral_5m_input_tokens ?? 0) + (breakdown.ephemeral_1h_input_tokens ?? 0)
        : 0),
    cacheCreation5mTokens: hasBreakdown ? breakdown.ephemeral_5m_input_tokens ?? 0 : null,
    cacheCreation1hTokens: hasBreakdown ? breakdown.ephemeral_1h_input_tokens ?? 0 : null,
  };
}

/** モデルIDとトークン内訳から USD コストを算出。未知モデルは { costUsd: 0, unknownPricing: true }。 */
export function computeCostUsd(
  model: string,
  t: TokenBreakdown
): { costUsd: number; unknownPricing: boolean } {
  const p = MODEL_PRICING_PER_MTOK[model];
  if (!p) return { costUsd: 0, unknownPricing: true };
  // T-189: キャッシュ書込は TTL で単価が違う（5分 = input×1.25 = cacheWrite / 1h = input×2）。
  // TTL別内訳が取れる場合はそれで計上し、取れない旧形式は従来計算（全量 cacheWrite）にフォールバック。
  const cacheWriteWeighted =
    t.cacheCreation5mTokens != null || t.cacheCreation1hTokens != null
      ? (t.cacheCreation5mTokens ?? 0) * p.cacheWrite + (t.cacheCreation1hTokens ?? 0) * p.input * 2
      : t.cacheCreationTokens * p.cacheWrite;
  const costUsd =
    (t.inputTokens * p.input +
      t.outputTokens * p.output +
      t.cacheReadTokens * p.cacheRead +
      cacheWriteWeighted) /
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
  // T-163: 所要時間の実測（optional。渡さない既存呼び出し元は null 記録のまま壊れない）。
  latencyMs?: number | null; // Anthropic API 呼び出しの所要時間(ms)
  contextBuildMs?: number | null; // 候補者contextビルドの所要時間(ms)。キャッシュヒット時は 0
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
        latencyMs: params.latencyMs ?? null,
        contextBuildMs: params.contextBuildMs ?? null,
      },
    });
  } catch (e) {
    // 記録失敗は本体処理に影響させない（ログのみ）。
    console.error("[recordAdvisorUsage] failed to persist usage:", e);
  }
}
