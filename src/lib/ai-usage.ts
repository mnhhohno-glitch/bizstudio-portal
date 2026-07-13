// T-135 AI費用帳簿: 記録ヘルパ（portal 内から DB 直書き）。
//
// 大原則:
//   1. **記録は本処理を絶対に止めない**。全て try-catch で隔離し、失敗しても throw しない（fire-and-forget）。
//      DB 障害・スキーマ不整合・不正な値でも、AI 機能そのものは正常完了させる。
//   2. 記録自体は AI を呼ばない（費用増ゼロ）。
//   3. 費用算出は src/lib/ai-pricing.ts の単価表が単一ソース。
//
// portal 内からはこの関数を直接呼ぶ（HTTP を介さない）。
// kyuujin / job-platform からは POST /api/internal/ai-usage を叩く（同じ計算・同じテーブルへ入る）。

import { prisma } from "@/lib/prisma";
import { estimateCostJpy } from "@/lib/ai-pricing";
import { Prisma } from "@prisma/client";

export type AiSystem = "portal" | "kyuujin" | "job-platform";

export type RecordAiUsageParams = {
  system: AiSystem;
  /** 処理の識別子。grep できる固定文字列を使う（'resume-parse' 等） */
  endpoint: string;
  /** 実際に API へ投げたモデルID */
  model: string;
  /** 非キャッシュ入力トークン */
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** キャッシュヒット分（Gemini cachedContentTokenCount / Claude cache_read_input_tokens） */
  cachedInputTokens?: number | null;
  /** 任意の付帯情報（candidateId・件数・エラー種別など） */
  meta?: Record<string, unknown> | null;
};

/**
 * AI 使用量を1行記録する。**絶対に throw しない**（呼び出し側は await しても落ちない）。
 * 戻り値は成功可否のみ（呼び出し側は基本無視してよい）。
 */
export async function recordAiUsage(params: RecordAiUsageParams): Promise<boolean> {
  try {
    const inputTokens = normalizeCount(params.inputTokens);
    const outputTokens = normalizeCount(params.outputTokens);
    const cachedInputTokens = normalizeCount(params.cachedInputTokens);

    const costJpy = estimateCostJpy(params.model, {
      inputTokens,
      outputTokens,
      cachedInputTokens,
    });

    await prisma.aiUsageLog.create({
      data: {
        system: params.system,
        endpoint: params.endpoint,
        model: params.model,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        // 単価表に無いモデルは null（未算出）で残す。後から単価を足して再計算できる。
        estimatedCostJpy: costJpy === null ? null : new Prisma.Decimal(costJpy.toFixed(6)),
        meta: (params.meta ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    return true;
  } catch (e) {
    // 記録失敗は本処理に影響させない。ログだけ残す。
    console.error("[ai-usage] 記録に失敗（本処理は継続）:", e);
    return false;
  }
}

function normalizeCount(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.round(v));
}

// ---------------------------------------------------------------------------
// SDK レスポンス → 記録 のアダプタ
// ---------------------------------------------------------------------------

/** Gemini generateContent の usageMetadata（フィールドは全て任意＝欠損しうる）。 */
export type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
};

/**
 * Gemini の usageMetadata を記録する。
 *
 * 重要: Gemini の promptTokenCount は**キャッシュヒット分を含んだ総入力**。単価が違うので、
 * ここで cachedContentTokenCount を差し引いて「非キャッシュ入力」に正規化してから渡す。
 */
export async function recordGeminiUsage(args: {
  system: AiSystem;
  endpoint: string;
  model: string;
  usage: GeminiUsageMetadata | null | undefined;
  meta?: Record<string, unknown> | null;
}): Promise<boolean> {
  const um = args.usage ?? {};
  const cached = um.cachedContentTokenCount ?? 0;
  const prompt = um.promptTokenCount ?? 0;
  return recordAiUsage({
    system: args.system,
    endpoint: args.endpoint,
    model: args.model,
    inputTokens: Math.max(0, prompt - cached),
    outputTokens: um.candidatesTokenCount ?? 0,
    cachedInputTokens: cached,
    meta: args.meta,
  });
}

/** Anthropic messages API の usage。 */
export type AnthropicUsageShape = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

/**
 * Anthropic の usage を記録する。
 * cache_creation（書込み）は入力の1.25倍単価だが、本帳簿は3区分しか持たないため
 * 非キャッシュ入力として合算する（過小評価にならない側へ倒す＝input 単価で計上）。
 * 正確な Claude 内訳が要る場合は既存の AdvisorUsageLog を参照する。
 */
export async function recordAnthropicUsage(args: {
  system: AiSystem;
  endpoint: string;
  model: string;
  usage: AnthropicUsageShape | null | undefined;
  meta?: Record<string, unknown> | null;
}): Promise<boolean> {
  const u = args.usage ?? {};
  return recordAiUsage({
    system: args.system,
    endpoint: args.endpoint,
    model: args.model,
    inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
    cachedInputTokens: u.cache_read_input_tokens ?? 0,
    meta: args.meta,
  });
}
