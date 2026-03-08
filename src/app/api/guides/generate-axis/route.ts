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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "AI生成に失敗しました。しばらく経ってから再度お試しください" },
        { status: 500 }
      );
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `あなたは転職支援のキャリアアドバイザーです。
求職者が記入した3つの問い（なぜ転職するのか・何を大切にして働きたいか・どんな自分になりたいか）の回答を読み、
その人の「転職軸」を簡潔にまとめてください。

ルール:
- 3つの回答から一貫したテーマや価値観を抽出する
- 面接で「私の転職軸は〇〇です」と言えるような、1〜3文程度の簡潔な軸を生成する
- その後に、補足として軸の根拠を2〜3行で説明する
- 丁寧ですが堅すぎない文体にする
- 出力形式:
  【転職軸】
  （1〜3文の転職軸）

  【根拠】
  （2〜3行の補足説明）`,
          },
          {
            role: "user",
            content: `以下の3つの問いへの回答から、転職軸をまとめてください。

■ なぜ転職するのか？
${reason_for_change}

■ 何を大切にして働きたいか？
${work_values}

■ どんな自分になりたいか？
${future_vision}`,
          },
        ],
        temperature: 0.5,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "AI生成に失敗しました。しばらく経ってから再度お試しください" },
        { status: 500 }
      );
    }

    const result = await response.json();
    const axis = result.choices?.[0]?.message?.content;

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
