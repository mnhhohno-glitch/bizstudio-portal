import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AppState } from "@/types/jimu";

export async function POST(request: Request) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json({ error: "トークンが必要です" }, { status: 400 });
    }

    const session = await prisma.jimuSession.findUnique({
      where: { token },
    });

    if (!session) {
      return NextResponse.json(
        { error: "セッションが見つかりません" },
        { status: 404 }
      );
    }

    const state = session.state as unknown as AppState;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "API キーが設定されていません" },
        { status: 500 }
      );
    }

    const anthropic = new Anthropic({ apiKey });

    const jobTypeLabel =
      state.detectedJobType === "general" ? "一般事務" : "営業事務";

    const systemPrompt = `あなたはキャリアアドバイザーです。
転職・就活希望者が事務職を目指す理由を深掘りした結果を受け取り、
「職種への志望動機」を言語化するレポートを生成してください。

※ これは「職種への志望動機」です。「企業への志望動機」ではありません。

出力は以下の構造で、マークダウンではなくプレーンテキストで出力してください：

━━━━━━━━━━━━━━━━━━━━
■ パート1：あなたの志望動機の素材
━━━━━━━━━━━━━━━━━━━━

【あなたの事務タイプ】
一行で表現（例：「正確さで組織を支える・縁の下タイプ」）

【あなたが${jobTypeLabel}に惹かれた理由】
シナリオで一番印象に残った場面と、その理由から読み取れる価値観を2〜3文で整理。

【過去の経験とのつながり】
自由記述で書かれた過去体験が、事務の仕事のどこにつながるかを2〜3文で示す。

【あなたの強みになるキーワード】
この人の回答全体から抽出した3〜4個のキーワード（例：「先回り力」「正確さ」「チーム連携」）

━━━━━━━━━━━━━━━━━━━━
■ パート2：面接で使える志望動機（完成版）
━━━━━━━━━━━━━━━━━━━━

【職種志望動機（3〜4文）】
パート1の素材を使って、面接でそのまま話せるレベルの志望動機を生成。
- 1文目：この職種に興味を持ったきっかけ
- 2文目：自分の経験との接点
- 3文目：この職種でどう貢献したいか
- 条件面（土日休み・安定など）は絶対に含めない

【面接で使えるキーフレーズ】
1〜2文。志望動機の中で特に強調すべきフレーズ。

━━━━━━━━━━━━━━━━━━━━

トーン：温かく・断言する・上から目線にならない
文体：です・ます調`;

    const userMessage = `【診断された職種】${jobTypeLabel}
【Q1の回答】${state.answers.q1}
【Q2の回答】${state.answers.q2}
【Q3の回答】${state.answers.q3}
【Q4の回答】${state.answers.q4}
【自由記述があれば】${Object.values(state.freeTexts).filter(Boolean).join("、")}
【やりがいワード】${state.yarigaiWord}
【ストーリーで共感した場面（問いかけ③の回答）】${state.storyResponses.q3}
【一番印象に残ったシナリオ】シナリオ${state.reflection.mostImpressiveScenario}
【印象に残った理由】${state.reflection.whyImpressive}
【過去の近い体験】${state.reflection.pastExperience}
【一番うれしかった瞬間】${state.reflection.happiestMoment || "（未回答）"}`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const reportText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const updatedState = { ...state, reportText };
    await prisma.jimuSession.update({
      where: { token },
      data: {
        state: updatedState as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    return NextResponse.json({ report: reportText });
  } catch (error) {
    console.error("Report generation error:", error);
    return NextResponse.json(
      { error: "レポートの生成に失敗しました" },
      { status: 500 }
    );
  }
}
