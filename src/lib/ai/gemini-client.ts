/**
 * Gemini API 呼び出しクライアント
 * 環境変数 GEMINI_API_KEY を使用
 *
 * Model: gemini-3-flash-preview
 *
 * T-135: 全呼び出しの usage を AiUsageLog に記録する。呼び出し側は params.log に
 * { endpoint } を渡すだけでよい（記録は内部で fire-and-forget・失敗しても本処理は止まらない）。
 * log 未指定の呼び出しは記録されないため、**新しい呼び出しを足すときは必ず log を付けること**。
 */

import { recordGeminiUsage } from "@/lib/ai-usage";

const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/** T-135: AI費用帳簿への記録指定。endpoint は処理を識別する固定文字列。 */
export interface GeminiUsageLogParams {
  /** 処理の識別子（'interview-analyze' 等）。AiUsageLog.endpoint に入る */
  endpoint: string;
  /** 任意の付帯情報（candidateId・パス種別など） */
  meta?: Record<string, unknown>;
}

export interface GeminiGenerateParams {
  systemInstruction: string;
  userPrompt: string;
  responseMimeType?: "application/json" | "text/plain";
  responseSchema?: object;
  maxOutputTokens?: number;
  /** 抽出系は 0.1 で確定的に（参考: 他プロジェクト）。未指定時 0.2 */
  temperature?: number;
  /** T-135: 指定すると呼び出し後に AiUsageLog へ1行記録する（fire-and-forget）。 */
  log?: GeminiUsageLogParams;
}

/** PDF を添付して generateContent する用。contents の先頭に inlineData で PDF を置き、続けて userPrompt を送る */
export interface GeminiGenerateWithPdfParams extends GeminiGenerateParams {
  /** base64 エンコードした PDF バイナリ */
  pdfBase64: string;
}

/** 画像1枚を添付して Vision API に送る用（PDF→画像→Gemini Vision の構成で使用） */
export interface GeminiGenerateWithImageParams extends GeminiGenerateParams {
  /** base64 エンコードした PNG 画像 */
  imageBase64: string;
}

function buildRequestBody(
  params: GeminiGenerateParams,
  options?: { pdfBase64?: string; imageBase64?: string }
) {
  const userParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  if (options?.pdfBase64) {
    userParts.push({ inlineData: { mimeType: "application/pdf", data: options.pdfBase64 } });
  }
  if (options?.imageBase64) {
    userParts.push({ inlineData: { mimeType: "image/png", data: options.imageBase64 } });
  }
  userParts.push({ text: params.userPrompt });

  return {
    system_instruction: {
      parts: [{ text: params.systemInstruction }],
    },
    contents: [{ parts: userParts }],
    generationConfig: {
      temperature: params.temperature ?? 0.2,
      maxOutputTokens: params.maxOutputTokens ?? 32768,
      responseMimeType: params.responseMimeType ?? "application/json",
      ...(params.responseSchema && { responseSchema: params.responseSchema }),
    },
  };
}

export async function generateWithGemini(params: GeminiGenerateParams): Promise<string> {
  return generateWithGeminiInternal(buildRequestBody(params), params.log);
}

/** Gemini の usageMetadata（コスト記録用）。欠損時は 0 扱い。 */
export interface GeminiUsage {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

/** 使用したモデルID（コスト記録のキーに使う）。 */
export const GEMINI_MODEL_ID = GEMINI_MODEL;

/**
 * generateWithGemini と同じだがトークン usage も返す。コスト永続化が必要な呼び出し用。
 * 既存の generateWithGemini は不変（呼び出し側に影響なし）。
 */
export async function generateWithGeminiDetailed(
  params: GeminiGenerateParams,
): Promise<{ text: string; usage: GeminiUsage }> {
  return generateWithGeminiDetailedInternal(buildRequestBody(params), params.log);
}

/** PDF を添付して Gemini に送り、応答テキストを返す */
export async function generateWithGeminiWithPdf(params: GeminiGenerateWithPdfParams): Promise<string> {
  return generateWithGeminiInternal(buildRequestBody(params, { pdfBase64: params.pdfBase64 }), params.log);
}

/** 画像1枚を添付して Gemini Vision に送り、応答テキストを返す。PDF→画像→各ページVision で抽出する構成で使用 */
export async function generateWithGeminiWithImage(params: GeminiGenerateWithImageParams): Promise<string> {
  return generateWithGeminiInternal(buildRequestBody(params, { imageBase64: params.imageBase64 }), params.log);
}

async function generateWithGeminiInternal(
  requestBody: ReturnType<typeof buildRequestBody>,
  log?: GeminiUsageLogParams,
): Promise<string> {
  const { text } = await generateWithGeminiDetailedInternal(requestBody, log);
  return text;
}

async function generateWithGeminiDetailedInternal(
  requestBody: ReturnType<typeof buildRequestBody>,
  log?: GeminiUsageLogParams,
): Promise<{ text: string; usage: GeminiUsage }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "ここにあなたのAPIキー") {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini API error:", response.status, errorText);
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      cachedContentTokenCount?: number;
      totalTokenCount?: number;
    };
  };

  // T-135: usage の記録は**応答検証より前**に行う。空candidates（ブロック/思考トークン枯渇）でも
  // 入力トークンは課金されるため、throw して記録が漏れると「見えない費用」が生まれる。
  // 記録は fire-and-forget（await しない・失敗しても本処理に影響しない）。
  if (log) {
    void recordGeminiUsage({
      system: "portal",
      endpoint: log.endpoint,
      model: GEMINI_MODEL,
      usage: data.usageMetadata,
      meta: {
        ...log.meta,
        finishReason: data.candidates?.[0]?.finishReason ?? null,
        // 応答が取れなかったコールも費用は発生している。原因追跡用に残す。
        ...(data.candidates?.length ? {} : { blocked: data.promptFeedback?.blockReason ?? "NO_CANDIDATES" }),
      },
    });
  }

  const candidates = data.candidates;
  if (!candidates || candidates.length === 0) {
    const blockReason = data.promptFeedback?.blockReason ?? "UNSPECIFIED";
    const blockMsg = data.promptFeedback?.blockReasonMessage ?? "";
    const detail = blockMsg ? `${blockReason}: ${blockMsg}` : blockReason;
    console.error("[Gemini] Empty candidates. promptFeedback:", JSON.stringify(data.promptFeedback));
    throw new Error(`No response from Gemini (${detail})`);
  }

  const content = candidates[0].content;
  if (!content?.parts?.length) {
    throw new Error("Invalid response structure from Gemini");
  }

  const text = content.parts[0].text;
  if (typeof text !== "string") {
    throw new Error("Empty response from Gemini");
  }

  const um = data.usageMetadata ?? {};
  const usage: GeminiUsage = {
    promptTokenCount: um.promptTokenCount ?? 0,
    candidatesTokenCount: um.candidatesTokenCount ?? 0,
    totalTokenCount: um.totalTokenCount ?? 0,
  };

  return { text, usage };
}

/**
 * JSON応答をパース。マークダウンコードブロック・前後の説明文を除去してパース。
 * 途中で切れたJSONは閉じ括弧を補って修復を試みる（参考: 他プロジェクトの _repair_truncated_json）。
 */
export function parseJsonResponse<T = unknown>(raw: string): T {
  let cleaned = raw.trim();
  const codeBlockMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }
  const firstBrace = cleaned.indexOf("{");
  const firstBracket = cleaned.indexOf("[");
  const start = firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)
    ? firstBrace
    : firstBracket;
  if (start >= 0) {
    const slice = cleaned.slice(start);
    try {
      return JSON.parse(slice) as T;
    } catch {
      const repaired = repairTruncatedJson(slice);
      if (repaired) {
        try {
          return JSON.parse(repaired) as T;
        } catch {
          // fall through to throw
        }
      }
    }
  }
  throw new Error("Response is not valid JSON");
}

function repairTruncatedJson(jsonStr: string): string | null {
  try {
    let inString = false;
    let escapeNext = false;
    for (const char of jsonStr) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === "\\") {
        escapeNext = true;
        continue;
      }
      if (char === '"') inString = !inString;
    }
    if (inString) jsonStr += '"';
    const openBraces = (jsonStr.match(/{/g)?.length ?? 0) - (jsonStr.match(/}/g)?.length ?? 0);
    const openBrackets = (jsonStr.match(/\[/g)?.length ?? 0) - (jsonStr.match(/]/g)?.length ?? 0);
    jsonStr = jsonStr.trimEnd().replace(/,\s*$/, "");
    jsonStr += "]".repeat(Math.max(0, openBrackets)) + "}".repeat(Math.max(0, openBraces));
    return jsonStr;
  } catch {
    return null;
  }
}
