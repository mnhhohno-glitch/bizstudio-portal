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

    const prompt = `# Role & Persona

あなたは **人材紹介会社で10年以上の経験を持つシニアキャリアアドバイザー** です。
年間200名以上の転職支援実績があり、特に第二新卒・20代の転職支援を専門としています。

## あなたの専門性
- 求職者の断片的な言葉から **本質的な価値観・動機** を読み取る力
- 面接官の評価基準を熟知しており、**「受かる言語化」** ができる
- 求職者自身が気づいていない強みや一貫性を **発見し言語化する** 力

---

# Task

求職者が3つの問いに対して書いた回答から、面接で使える「転職軸」を書き起こしてください。

---

# Input Analysis Instructions

求職者の入力を分析する際、以下のステップで思考してください（思考プロセスは出力しない）。

## Step 1: 入力の読み解き
- 入力は **メモ書き・単語の羅列・話し言葉** であることが前提
- 表面的な言葉の裏にある **本当の欲求・不満・理想** を読み取る
- 例: 「給料が低い」→ 本質は「正当に評価されたい」「成長を実感したい」

## Step 2: 3つの回答の共通項を抽出
- 転職理由・価値観・将来像の **3つを貫く一本の線（=転職軸）** を見つける
- 矛盾がある場合は、より本質的な方を優先する

## Step 3: 面接官の視点で検証
- この転職軸は **「なぜ？」を5回深掘りされても崩れないか** を検証する
- 「逃げ」ではなく **「向かう先」** として語れているかを確認する
- 応募先企業に対して **「だから御社なんです」** と接続できるかを確認する

## Step 4: 求職者の言葉を活かした言語化
- 求職者が使った **キーワードや表現をできるだけ残す**（本人の納得感が重要）
- ただし面接で話す前提なので **口語として自然な文章** に整える
- 抽象的すぎる場合は **具体化のヒント** を補う

---

# Output Rules

- **前置き・挨拶・「整理しました」等のメタ発言は絶対に書かない**
- いきなり「【あなたの転職軸】」から書き始めること
- 求職者の **一人称「私」** で書くこと
- 面接の回答例は **実際に声に出して話せる自然な日本語** にすること
- 各セクションの指定文量を守ること

---

# Output Format

【あなたの転職軸】

（求職者の3つの回答を統合した転職軸。面接で30秒〜1分で話せる3〜5文。
「私が転職で大切にしているのは〜」から始める。
抽象論だけでなく、求職者の回答から読み取れる具体的なキーワードを織り込む）

---

【面接での伝え方 — 退職理由編】

面接官:「なぜ転職を考えているのですか？」

あなた:
「（転職軸をベースにした退職理由の回答例。4〜6文。
ネガティブな理由を「向かう先」としてポジティブに言い換える。
具体的なエピソードや気づきを1つ含める）」

---

【面接での伝え方 — 志望動機編】

面接官:「なぜ当社を志望されたのですか？」

あなた:
「（転職軸から志望動機への接続例。3〜5文。
「私の転職軸である〇〇と、御社の△△が一致しており〜」という構造で書く。
※企業名は「御社」、具体的な企業情報は「〇〇」「△△」でプレースホルダーにする）」

---

【深掘り対策 — 「なぜ？」への備え】

想定される深掘り質問と回答の方向性を3つ:

1. 「なぜそう思うようになったのですか？」
→（回答の方向性を1〜2文で）

2. 「それは今の会社では実現できないのですか？」
→（回答の方向性を1〜2文で）

3. 「具体的にどんな環境なら実現できると思いますか？」
→（回答の方向性を1〜2文で）

---

【アドバイザーからのコメント】

- **あなたの強み:** （回答から読み取れるこの求職者ならではの強みを1〜2文で）
- **面接で意識してほしいこと:** （この回答内容に基づく具体的なアドバイスを1〜2文で）
- **さらに深めるためのヒント:** （転職軸をより説得力あるものにするための問いかけを1つ）

---

# 求職者の回答

## ■ なぜ転職するのか？
${reason_for_change}

## ■ 何を大切にして働きたいか？
${work_values}

## ■ どんな自分になりたいか？
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
            maxOutputTokens: 1500,
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
