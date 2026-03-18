import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { text } = body;

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "テキストが空です" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEYが設定されていません" }, { status: 500 });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `あなたは転職エージェントのアシスタントです。
以下は求職者の求人検索に関するポイントや条件のメモです。
これを整理してマークダウン形式で見やすくまとめてください。

ルール:
- カテゴリごとに分類する（例: 年収・待遇、勤務条件、キャリア志向 など）
- 箇条書きで整理する
- 元の内容を勝手に変更しない（表現の整理のみ）
- 簡潔に、余計な前置きや説明は不要
- マークダウン形式で出力する

メモ:
${text.trim()}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2048,
          },
        }),
      }
    );

    if (!response.ok) {
      console.error("Gemini API error:", await response.text());
      return NextResponse.json(
        { error: "AI整理に失敗しました。しばらく経ってから再度お試しください" },
        { status: 500 }
      );
    }

    const data = await response.json();
    const organized = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!organized) {
      return NextResponse.json(
        { error: "AI整理に失敗しました。しばらく経ってから再度お試しください" },
        { status: 500 }
      );
    }

    return NextResponse.json({ organized });
  } catch (error) {
    console.error("Gemini API error:", error);
    return NextResponse.json(
      { error: "AI整理に失敗しました。しばらく経ってから再度お試しください" },
      { status: 500 }
    );
  }
}
