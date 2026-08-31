/**
 * Gemini に「JSONだけを返す」プロンプトを投げ、構造化オブジェクトを取り出す共通処理。
 *
 * 履歴書解析（求職者・社員）で同じ失敗をしていたため 2026-08-12 に共通化した。
 * 個別のプロンプト・フィールドマッピングは呼び出し側が持ち、ここは
 * 「呼ぶ → 費用記録 → JSON取り出し → 一時的な失敗ならリトライ」だけを担当する。
 */

import { recordGeminiUsage, type GeminiUsageMetadata } from "@/lib/ai-usage";

export const GEMINI_MODEL = "gemini-3-flash-preview";

/**
 * リトライ計画。
 *
 * gemini-3-flash-preview は thinking モデルで、思考トークンも maxOutputTokens の枠を消費する。
 * 同一PDFを16回投げた実測で思考量は 1799〜3131 と 1300トークン以上ぶれるため、枠が近いと
 * 上振れした回だけ JSON が途中で切れる（本番の失敗5件は全て 思考+出力 = 3996 で枠4000に到達）。
 * 枠は上限であって予約ではなく、実際に生成した分しか課金されないため、初回から広く取る。
 */
const ATTEMPT_PLAN: ReadonlyArray<{ maxOutputTokens: number; delayMs: number }> = [
  { maxOutputTokens: 8192, delayMs: 0 },
  { maxOutputTokens: 8192, delayMs: 1000 },
  { maxOutputTokens: 8192, delayMs: 3000 },
];

/** 再試行しても結果が変わらない finishReason（内容起因のブロック） */
const NON_RETRYABLE_FINISH_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
]);

/**
 * Gemini からJSONを取り出せなかったときのエラー。
 * 切り分けに要る情報（HTTPステータス・finishReason・試行回数）を持たせ、
 * 呼び出し側が通知やDBに載せられるようにする。
 */
export class GeminiJsonError extends Error {
  readonly httpStatus: number | null;
  readonly finishReason: string | null;
  readonly attempts: number;

  constructor(params: {
    message: string;
    httpStatus: number | null;
    finishReason: string | null;
    attempts: number;
  }) {
    super(params.message);
    this.name = "GeminiJsonError";
    this.httpStatus = params.httpStatus;
    this.finishReason = params.finishReason;
    this.attempts = params.attempts;
  }

  /** 通知・ログ用の1行サマリ（「AI解析失敗」だけでは切り分けできないため） */
  get diagnostics(): string {
    return [
      `finishReason=${this.finishReason ?? "null"}`,
      `HTTP=${this.httpStatus ?? "-"}`,
      `試行=${this.attempts}回`,
    ].join(" / ");
  }
}

type AttemptOutcome =
  | { ok: true; parsed: Record<string, unknown> }
  | {
      ok: false;
      retryable: boolean;
      message: string;
      httpStatus: number | null;
      finishReason: string | null;
    };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Gemini の応答テキストからJSON部分を取り出す。```json ラッパーや前後の地の文を許容する。 */
function extractJson(rawText: string): Record<string, unknown> {
  // 1) マークダウンコードブロック内の JSON を抽出
  const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  // 2) コードブロックがなければ最初の { から最後の } までを抽出
  const jsonStr = codeBlockMatch
    ? codeBlockMatch[1].trim()
    : rawText.substring(rawText.indexOf("{"), rawText.lastIndexOf("}") + 1);
  return JSON.parse(jsonStr);
}

/** Gemini への1回分の呼び出し。throw せず結果を返す（リトライ可否を呼び出し側で判断するため）。 */
async function attemptCall(params: {
  apiKey: string;
  parts: unknown[];
  endpoint: string;
  temperature: number;
  maxOutputTokens: number;
  attempt: number;
  totalAttempts: number;
  logMeta?: Record<string, unknown>;
}): Promise<AttemptOutcome> {
  const { apiKey, parts, endpoint, temperature, maxOutputTokens, attempt, totalAttempts, logMeta } =
    params;
  const tag = `[gemini-json/${endpoint}] attempt ${attempt}/${totalAttempts} (maxOutputTokens=${maxOutputTokens})`;

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature, maxOutputTokens },
        }),
      },
    );
  } catch (e) {
    // ネットワーク断・タイムアウト等。典型的な一時障害なのでリトライする
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${tag} fetch failed:`, msg);
    return {
      ok: false,
      retryable: true,
      message: `Gemini API 通信エラー: ${msg}`,
      httpStatus: null,
      finishReason: null,
    };
  }

  if (!response.ok) {
    // 原因追跡用: HTTPステータスに加えてレスポンスボディの先頭500文字を残す
    // （AI Studio 側は成功率100%に見えても、ここで落ちていれば本文にエラー詳細が入る）
    let errorBody = "";
    try {
      errorBody = (await response.text()).substring(0, 500);
    } catch {
      errorBody = "(body 読み取り失敗)";
    }
    console.error(`${tag} Gemini API error. status=${response.status} body(500):`, errorBody);
    // 429=レート制限 / 5xx=サーバ側障害 は一時的。4xx（キー不正・リクエスト不正）は再試行しても同じ
    return {
      ok: false,
      retryable: response.status === 429 || response.status >= 500,
      message: `Gemini API error: ${response.status}`,
      httpStatus: response.status,
      finishReason: null,
    };
  }

  let data: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    usageMetadata?: GeminiUsageMetadata;
  };
  try {
    data = await response.json();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${tag} response.json() failed. status=${response.status}:`, msg);
    return {
      ok: false,
      retryable: true,
      message: `Gemini レスポンスがJSONではありません: ${msg}`,
      httpStatus: response.status,
      finishReason: null,
    };
  }

  // finishReason は成否判定には使わず、失敗時のログ・通知用に保持する
  // （MAX_TOKENS = 出力途中切れ、SAFETY = ブロック 等の切り分けに必要）
  const finishReason: string | null = data?.candidates?.[0]?.finishReason ?? null;

  // T-135: 費用記録（fire-and-forget）。空レスポンスで throw する前に記録する
  // （空でも入力トークンは課金されるため、ここで漏らすと「見えない費用」になる）。
  // attempt / maxOutputTokens も残し、リトライ分の費用を帳簿上で切り分けられるようにする。
  void recordGeminiUsage({
    system: "portal",
    endpoint,
    model: GEMINI_MODEL,
    usage: data?.usageMetadata,
    meta: { finishReason, attempt, maxOutputTokens, ...logMeta },
  });

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText || typeof rawText !== "string") {
    console.error(
      `${tag} Empty response. status=${response.status} finishReason=${finishReason ?? "null"} body(500):`,
      JSON.stringify(data).substring(0, 500),
    );
    // 思考トークンだけで出力枠を使い切ると本文が空になる。枠に余裕があれば通る可能性がある
    return {
      ok: false,
      retryable: !NON_RETRYABLE_FINISH_REASONS.has(finishReason ?? ""),
      message: `Gemini レスポンスが空です（finishReason=${finishReason ?? "null"}）`,
      httpStatus: response.status,
      finishReason,
    };
  }

  try {
    return { ok: true, parsed: extractJson(rawText) };
  } catch {
    console.error(
      `${tag} JSON parse failed. status=${response.status} finishReason=${finishReason ?? "null"} rawTextLength=${rawText.length} rawText(500):`,
      rawText.substring(0, 500),
    );
    return {
      ok: false,
      retryable: !NON_RETRYABLE_FINISH_REASONS.has(finishReason ?? ""),
      message: `Gemini レスポンスのJSON解析に失敗しました（finishReason=${finishReason ?? "null"}）`,
      httpStatus: response.status,
      finishReason,
    };
  }
}

/**
 * Gemini に parts（inlineData / text）を投げ、JSONオブジェクトを取り出して返す。
 *
 * 一時的な失敗（レート制限 / 5xx / 通信断 / 出力途中切れ）は ATTEMPT_PLAN に従い最大3回リトライする。
 * 全試行が失敗した場合、および再試行しても無駄な失敗（4xx / 内容ブロック）は GeminiJsonError を throw する。
 */
export async function callGeminiForJson(params: {
  /** contents[0].parts にそのまま入る配列（inlineData / text） */
  parts: unknown[];
  /** 費用帳簿の endpoint 名（'resume-parse' 等） */
  endpoint: string;
  /** 費用帳簿の付帯情報 */
  logMeta?: Record<string, unknown>;
  temperature?: number;
}): Promise<Record<string, unknown>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY が設定されていません");
  }

  const totalAttempts = ATTEMPT_PLAN.length;
  let lastMessage = "Gemini 解析に失敗しました";
  let lastHttpStatus: number | null = null;
  let lastFinishReason: string | null = null;

  for (let i = 0; i < totalAttempts; i++) {
    const plan = ATTEMPT_PLAN[i];
    if (plan.delayMs > 0) await sleep(plan.delayMs);

    const outcome = await attemptCall({
      apiKey,
      parts: params.parts,
      endpoint: params.endpoint,
      temperature: params.temperature ?? 0.1,
      maxOutputTokens: plan.maxOutputTokens,
      attempt: i + 1,
      totalAttempts,
      logMeta: params.logMeta,
    });

    if (outcome.ok) {
      if (i > 0) {
        console.warn(`[gemini-json/${params.endpoint}] リトライで成功 (attempt ${i + 1}/${totalAttempts})`);
      }
      return outcome.parsed;
    }

    lastMessage = outcome.message;
    lastHttpStatus = outcome.httpStatus;
    lastFinishReason = outcome.finishReason;

    if (!outcome.retryable) {
      throw new GeminiJsonError({
        message: lastMessage,
        httpStatus: lastHttpStatus,
        finishReason: lastFinishReason,
        attempts: i + 1,
      });
    }
  }

  throw new GeminiJsonError({
    message: `${lastMessage}｜${totalAttempts}回リトライしても解析できませんでした`,
    httpStatus: lastHttpStatus,
    finishReason: lastFinishReason,
    attempts: totalAttempts,
  });
}
