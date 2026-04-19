/**
 * Gemini API 呼び出しクライアント
 * 環境変数 GEMINI_API_KEY を使用
 * 
 * Model: gemini-2.0-flash (安定版の高速モデル)
 */

const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface GeminiGenerateParams {
  systemInstruction: string;
  userPrompt: string;
  responseMimeType?: "application/json" | "text/plain";
  responseSchema?: object;
  maxOutputTokens?: number;
  /** 抽出系は 0.1 で確定的に（参考: 他プロジェクト）。未指定時 0.2 */
  temperature?: number;
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
  return generateWithGeminiInternal(buildRequestBody(params));
}

/** PDF を添付して Gemini に送り、応答テキストを返す */
export async function generateWithGeminiWithPdf(params: GeminiGenerateWithPdfParams): Promise<string> {
  return generateWithGeminiInternal(buildRequestBody(params, { pdfBase64: params.pdfBase64 }));
}

/** 画像1枚を添付して Gemini Vision に送り、応答テキストを返す。PDF→画像→各ページVision で抽出する構成で使用 */
export async function generateWithGeminiWithImage(params: GeminiGenerateWithImageParams): Promise<string> {
  return generateWithGeminiInternal(buildRequestBody(params, { imageBase64: params.imageBase64 }));
}

async function generateWithGeminiInternal(requestBody: ReturnType<typeof buildRequestBody>): Promise<string> {
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
  };

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

  return text;
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
    let slice = cleaned.slice(start);
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
