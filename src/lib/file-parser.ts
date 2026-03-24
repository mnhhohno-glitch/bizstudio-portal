async function callOpenAIWithFile(
  base64Data: string,
  mimeType: string,
  prompt: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY が未設定です");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Data}`,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
      max_completion_tokens: 3000,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("OpenAI file parse error:", JSON.stringify(data));
    return "（ファイルの読み取りに失敗しました）";
  }

  return data.choices?.[0]?.message?.content || "（ファイルの読み取りに失敗しました）";
}

export async function parsePdfWithAI(base64Data: string): Promise<string> {
  return callOpenAIWithFile(
    base64Data,
    "application/pdf",
    "このドキュメントの内容を正確に読み取り、テキストとして書き起こしてください。前置きは不要です。内容をそのまま書き起こしてください。"
  );
}

export async function parseImageWithAI(
  base64Data: string,
  mimeType: string
): Promise<string> {
  return callOpenAIWithFile(
    base64Data,
    mimeType,
    "この画像の内容を詳しく説明してください。テキストが含まれている場合はすべて書き起こしてください。"
  );
}

export async function parseDocWithAI(
  base64Data: string,
  mimeType: string
): Promise<string> {
  return callOpenAIWithFile(
    base64Data,
    mimeType,
    "このドキュメントの内容を正確に読み取り、テキストとして書き起こしてください。表やリストがあればそのまま再現してください。前置きは不要です。"
  );
}

export function parseTextFile(base64Data: string): string {
  try {
    const buffer = Buffer.from(base64Data, "base64");
    return buffer.toString("utf-8");
  } catch {
    return "（テキストファイルの読み取りに失敗しました）";
  }
}
