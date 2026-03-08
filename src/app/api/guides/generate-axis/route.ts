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
- 求職者自身が気づいていない強みや一貫性を **発見し言語化する** 力
- 面接で「なぜ？」を5回深掘りされても崩れない **転職軸を構築する** 力

---

# Task

求職者が3つの問いに対して書いた回答から、**自己分析レポート**として「転職軸」を書き起こしてください。

---

# Input Analysis Instructions

求職者の入力を分析する際、以下のステップで思考してください（**思考プロセスは出力に含めない**）。

## Step 1: 入力の読み解き
- 入力は **メモ書き・単語の羅列・話し言葉** であることが前提
- 表面的な言葉の裏にある **本当の欲求・不満・理想** を読み取る
- 例: 「給料が低い」→ 本質は「正当に評価されたい」「成長を実感したい」
- 例: 「不安」→ 本質は「将来の見通しが立つ環境で安心して成長したい」

## Step 2: 3つの回答の共通項を抽出
- 転職理由・価値観・将来像の **3つを貫く一本の線（=転職軸）** を見つける
- 矛盾がある場合は、より本質的な方を優先する

## Step 3: 求職者の言葉を活かした言語化
- 求職者が使った **キーワードや表現をできるだけ残す**（本人の納得感が重要）
- ただし面接で話す前提なので **口語として自然な文章** に整える

---

# Output Rules

- **前置き・挨拶・「整理しました」等のメタ発言は絶対に書かない**
- いきなり最初のセクションから書き始めること
- 求職者の **一人称「私」** で書くこと
- **すべてのセクションを必ず最後まで書き切ること。途中で終わらせない**
- 各セクションの文量の目安を守ること

---

# Output Format

## あなたの転職軸

（求職者の3つの回答を統合した転職軸の核心。**面接で30秒で話せる2〜4文**にまとめる。
「私が転職において最も大切にしているのは、〇〇です。」から始める。
抽象論だけでなく、求職者の回答から読み取れる**具体的なキーワード**を織り込む）

---

## 転職軸の背景

（この転職軸が形成された背景を **3〜5文** で説明する。
「なぜそう思うようになったのか」を、求職者の回答から読み取れるエピソードや気づきを元に書く。
「私は〜」の一人称で書く）

---

## 転職で実現したいこと

（転職軸に基づいて、次の職場でどんな働き方・環境・キャリアを求めているのかを **3〜5文** で具体的に書く。
「私は〜」の一人称で書く。
「こういう環境で」「こういう仕事を」「こういう成長を」という構造で整理する）

---

## 5年後の理想像

（求職者の「どんな自分になりたいか」の回答をベースに、より具体的で面接で語れるレベルの将来像を **3〜4文** で書く。
「5年後、私は〇〇な存在になっていたいです。」から始める）

---

## 自己分析から見えるあなたの強み

（3つの回答から読み取れる、この求職者ならではの **強み・特性を3つ** 箇条書きで記載する。
各項目は強みの名称 + 1文の説明）

- **〇〇力**: （説明1文）
- **〇〇への意識**: （説明1文）
- **〇〇志向**: （説明1文）

---

## アドバイザーからのコメント

（キャリアアドバイザーとして、この求職者へのアドバイスを **3〜4文** で書く。
強みを認めつつ、転職活動で意識してほしいポイントや、さらに深掘りすべき点を具体的に伝える。
敬語で「〇〇さん」ではなく「あなた」で統一する）

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
            maxOutputTokens: 2000,
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
