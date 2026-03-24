const GEMINI_MODEL = "gemini-2.5-flash-preview-05-20";

async function callGemini(
  parts: object[],
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
        contents: [{ parts }],
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

export async function parsePdfWithGemini(base64Data: string): Promise<string> {
  return callGemini([
    { inlineData: { mimeType: "application/pdf", data: base64Data } },
    { text: "このドキュメントの内容を正確に読み取り、テキストとして書き起こしてください。前置きは不要です。内容をそのまま書き起こしてください。" },
  ]);
}

export async function parseImageWithGemini(base64Data: string, mimeType: string): Promise<string> {
  return callGemini(
    [
      { inlineData: { mimeType, data: base64Data } },
      { text: "この画像の内容を詳しく説明してください。テキストが含まれている場合はすべて書き起こしてください。" },
    ],
    2000
  );
}

export async function parseDocWithGemini(base64Data: string, mimeType: string): Promise<string> {
  return callGemini([
    { inlineData: { mimeType, data: base64Data } },
    { text: "このドキュメントの内容を正確に読み取り、テキストとして書き起こしてください。表やリストがあればそのまま再現してください。前置きは不要です。" },
  ]);
}
