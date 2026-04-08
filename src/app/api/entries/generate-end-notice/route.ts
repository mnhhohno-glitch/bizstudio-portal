import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import OpenAI from "openai";

const REASON_PHRASES: Record<string, string> = {
  SKILL_MISMATCH: "ご経験・スキルと募集要件を総合的に検討された結果、今回は見送りとなりました。",
  COMPARISON: "他の候補者様との比較検討の結果、今回は見送りとなりました。",
  POSITION_CLOSED: "募集枠が充足したため、今回は見送りとなりました。",
  CULTURE_MISMATCH: "社風や組織との適合性を検討された結果、今回は見送りとなりました。",
  CONDITION_MISMATCH: "ご希望条件と求人条件の調整が難しく、今回は見送りとなりました。",
  DOCUMENT_SCREENING: "書類選考の結果、今回は見送りとなりました。",
};

type EntryInput = {
  companyName: string;
  reason: string;
  reasonText: string | null;
};

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
  const { candidateName, advisorName, format, entries } = body as {
    candidateName: string;
    advisorName: string;
    format: "line" | "email";
    entries: EntryInput[];
  };

  if (!candidateName || !advisorName || !entries?.length) {
    return NextResponse.json({ error: "必須パラメータが不足しています" }, { status: 400 });
  }

  // 各企業の理由表現を組み立て
  const companyDetails = entries.map((e) => {
    const phrase = e.reason === "OTHER" && e.reasonText
      ? `ユーザー入力の理由「${e.reasonText}」を丁寧な表現に整えて記載`
      : REASON_PHRASES[e.reason] || "選考の結果、今回は見送りとなりました。";
    return `■ ${e.companyName}\n${phrase}`;
  }).join("\n\n");

  const systemPrompt = `あなたは人材紹介会社「株式会社ビズスタジオ」のキャリアアドバイザーのアシスタントです。
求職者への選考終了案内文を作成してください。

## テンプレート構成（この順番・構成を必ず守ること）

【1. 宛名】
{求職者名}様

【2. 冒頭挨拶】
お世話になっております。
株式会社ビズスタジオの{担当CA名}でございます。

選考結果のご案内をお送りいたします。

【3. 選考終了企業一覧】
以下の企業様より選考終了のご連絡がございました。

## グルーピングルール
- 同じ理由の企業はグループ化して記載する
- 企業名を「■」付きで一覧にし、最後の企業名の下に理由を1回だけ記載する
- 異なる理由のグループは空行で区切る
- グループ内の企業の並び順は入力された順序を維持する

例：
■ 株式会社A
■ 株式会社B
ご経験・スキルと募集要件を総合的に検討された結果、今回は見送りとなりました。

■ 株式会社C
募集枠が充足したため、今回は見送りとなりました。

【4. 締めの挨拶】
ご期待に沿えず大変申し訳ございません。
引き続き、ご希望に合う求人をご紹介してまいりますので、今後ともよろしくお願いいたします。

## ルール
- LINE向けの場合: 件名不要、適度に改行を入れて読みやすくする
- メール向けの場合: 冒頭に「件名：選考結果のご案内」を付ける
- 企業名は必ず正式名称で記載
- 丁寧で温かみのあるトーンで書く
- テンプレートの構成を厳密に守ること`;

  const userMessage = `以下の内容で選考終了案内文を生成してください。

求職者名: ${candidateName}
担当CA名: ${advisorName}
送信形式: ${format === "line" ? "LINE" : "メール"}

選考終了企業と理由:
${companyDetails}`;

  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 4000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    const message = response.choices[0]?.message?.content || "";
    return NextResponse.json({ message });
  } catch (error) {
    console.error("GPT generation error:", error);
    return NextResponse.json({ error: "案内文の生成に失敗しました" }, { status: 500 });
  }
}
