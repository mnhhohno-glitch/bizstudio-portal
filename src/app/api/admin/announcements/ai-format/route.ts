import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { content } = body;

  if (!content || typeof content !== "string" || content.trim().length < 10) {
    return NextResponse.json({ error: "本文は10文字以上必要です" }, { status: 400 });
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
                  text: `あなたは社内ポータルサイトのお知らせ記事の編集者です。
以下の文章を読みやすく整理し、Markdown形式で書き直してください。

ルール:
- 内容や意味は変えない
- 誤字脱字を修正する
- 適切な見出し（##, ###）を付ける
- 箇条書きが適切な箇所はリスト化する
- 手順がある場合は番号付きリストにする
- 簡潔で丁寧な文体に統一する
- Markdownの記法のみ使用する（HTMLタグは使わない）
- 冒頭に挨拶文や余計な前置きを追加しない
- 出力はMarkdown本文のみ（コードブロックで囲まない）

入力文章:
${content.trim()}`,
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
    const formattedContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!formattedContent) {
      return NextResponse.json(
        { error: "AI整理に失敗しました。しばらく経ってから再度お試しください" },
        { status: 500 }
      );
    }

    return NextResponse.json({ formattedContent });
  } catch (error) {
    console.error("Gemini API error:", error);
    return NextResponse.json(
      { error: "AI整理に失敗しました。しばらく経ってから再度お試しください" },
      { status: 500 }
    );
  }
}
