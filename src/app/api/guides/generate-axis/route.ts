import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { reason_for_change, work_values, future_vision } = body;

    if (
      !reason_for_change?.trim() ||
      !work_values?.trim() ||
      !future_vision?.trim()
    ) {
      return NextResponse.json(
        { error: "3つの問いすべてに回答してください" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "AI生成に失敗しました。しばらく経ってから再度お試しください" },
        { status: 500 }
      );
    }

    const prompt = `あなたは転職支援のプロのキャリアアドバイザーです。
求職者が記入した3つの問いの回答を読み、その人の「転職軸」を簡潔にまとめてください。

重要なルール:
- 前置きや挨拶は一切不要。いきなり転職軸から書き始めること
- 出力は以下の形式のみ:

【転職軸】
（面接で「私の転職軸は〇〇です」と言える1〜3文の簡潔な軸）

【根拠】
（3つの回答から読み取れる一貫したテーマや価値観を2〜3行で説明）

【面接での伝え方の例】
（「私が転職で大切にしているのは〇〇です。なぜなら〜」という形で1つの例文）

--- ここから求職者の回答 ---

■ なぜ転職するのか？
${reason_for_change}

■ 何を大切にして働きたいか？
${work_values}

■ どんな自分になりたいか？
${future_vision}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 500,
          },
        }),
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "AI生成に失敗しました。しばらく経ってから再度お試しください" },
        { status: 500 }
      );
    }

    const result = await response.json();
    const axis = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!axis) {
      return NextResponse.json(
        { error: "AI生成に失敗しました。しばらく経ってから再度お試しください" },
        { status: 500 }
      );
    }

    return NextResponse.json({ axis });
  } catch {
    return NextResponse.json(
      { error: "AI生成に失敗しました。しばらく経ってから再度お試しください" },
      { status: 500 }
    );
  }
}
