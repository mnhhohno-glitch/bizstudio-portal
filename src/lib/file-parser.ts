const GEMINI_MODEL = "gemini-3-flash-preview";

async function callGemini(
  base64Data: string,
  mimeType: string,
  prompt: string,
  maxOutputTokens: number = 3000
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY が未設定です");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType, data: base64Data } },
            { text: prompt },
          ],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens },
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    console.error("Gemini API error:", response.status, text);
    return "（ファイルの読み取りに失敗しました）";
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "（ファイルの読み取りに失敗しました）";
}

/** PDF解析 — Gemini API */
export async function parsePdfWithAI(base64Data: string): Promise<string> {
  return callGemini(
    base64Data,
    "application/pdf",
    "このドキュメントの内容を正確に読み取り、テキストとして書き起こしてください。前置きは不要です。内容をそのまま書き起こしてください。"
  );
}

/** Word/Excel/PPT解析 — Gemini API */
export async function parseDocWithAI(
  base64Data: string,
  mimeType: string
): Promise<string> {
  return callGemini(
    base64Data,
    mimeType,
    "このドキュメントの内容を正確に読み取り、テキストとして書き起こしてください。表やリストがあればそのまま再現してください。前置きは不要です。"
  );
}

/** 画像解析 — Anthropic Claude Opus 4.6 */
export async function parseImageWithAI(
  base64Data: string,
  mimeType: string
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY が未設定です");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-6",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType,
                data: base64Data,
              },
            },
            {
              type: "text",
              text: "この画像の内容を詳しく説明してください。テキストが含まれている場合はすべて書き起こしてください。",
            },
          ],
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Anthropic image parse error:", JSON.stringify(data));
    return "（画像の読み取りに失敗しました）";
  }

  return data.content?.[0]?.text || "（画像の読み取りに失敗しました）";
}

/** テキストファイル — Base64デコードのみ */
export function parseTextFile(base64Data: string): string {
  try {
    const buffer = Buffer.from(base64Data, "base64");
    return buffer.toString("utf-8");
  } catch {
    return "（テキストファイルの読み取りに失敗しました）";
  }
}
