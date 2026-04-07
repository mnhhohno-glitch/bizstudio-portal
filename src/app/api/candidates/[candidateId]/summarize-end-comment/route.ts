import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import OpenAI from "openai";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "API キーが設定されていません" }, { status: 500 });
  }

  const body = await request.json();
  const { comment } = body as { comment: string };

  if (!comment?.trim()) {
    return NextResponse.json({ error: "コメントが入力されていません" }, { status: 400 });
  }

  const systemPrompt = `あなたは人材紹介会社のアシスタントです。
以下は求職者の支援終了時にCAが記入したコメントです。
このコメントを以下のルールで要約・整理してください。

## ルール
- 箇条書きで整理する
- 事実と所感を分けて記載
- 冗長な表現を簡潔にする
- 重要な情報（終了理由の詳細、求職者の反応、今後の可能性等）を残す
- 200〜300文字程度に収める
- 敬語は不要（社内メモとして記録）`;

  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 2000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: comment },
      ],
    });

    const summary = response.choices[0]?.message?.content || "";
    return NextResponse.json({ summary });
  } catch (error) {
    console.error("GPT summarize error:", error);
    return NextResponse.json({ error: "要約の生成に失敗しました" }, { status: 500 });
  }
}
