import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

const SYSTEM_PROMPT_TEMPLATE = `# Role & Persona

あなたは人材紹介会社「株式会社ビズスタジオ」のシニアキャリアアドバイザーです。
担当CAと一緒に、以下の求職者の転職支援を行います。

## あなたの専門性
- 年間200名以上の転職支援実績
- 求職者の本質的な価値観・動機を読み取る力
- 面接官の評価基準を熟知し、的確なアドバイスができる
- 求人マッチングの精度が高い

## 行動指針
- CAの質問や相談に対して、この求職者のデータを踏まえて具体的にアドバイスする
- 「この求職者なら〇〇」と、データに基づいた根拠のある回答をする
- 求職者の強み・課題を客観的に分析する
- 求人の提案時は、転職軸との一致度を説明する
- 面接対策のアドバイスは、実際のエピソードを活用した具体的なものにする
- 日本語で回答する

---

# 求職者データ

`;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string; sessionId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { sessionId } = await params;

  const messages = await prisma.advisorChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ messages });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string; sessionId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId, sessionId } = await params;
  const { content } = await req.json();

  if (!content?.trim()) {
    return NextResponse.json({ error: "メッセージは必須です" }, { status: 400 });
  }

  const userMessage = content.trim();

  // ユーザーメッセージ保存
  await prisma.advisorChatMessage.create({
    data: { sessionId, role: "user", content: userMessage },
  });

  // 過去メッセージ取得
  const pastMessages = await prisma.advisorChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });

  // セッションタイトル自動更新（初回メッセージ時）
  if (pastMessages.length === 1) {
    await prisma.advisorChatSession.update({
      where: { id: sessionId },
      data: { title: userMessage.substring(0, 30) + (userMessage.length > 30 ? "..." : "") },
    });
  }

  // コンテキスト取得
  let context = "";
  try {
    const baseUrl = process.env.PORTAL_BASE_URL || (req.headers.get("origin") ?? "");
    const contextRes = await fetch(`${baseUrl}/api/candidates/${candidateId}/advisor/context`, {
      headers: { cookie: req.headers.get("cookie") || "" },
    });
    if (contextRes.ok) {
      const contextData = await contextRes.json();
      context = contextData.context || "";
    }
  } catch (e) {
    console.error("Context fetch error:", e);
  }

  // OpenAI API呼び出し
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY が未設定です" }, { status: 500 });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5.4",
        messages: [
          { role: "system", content: SYSTEM_PROMPT_TEMPLATE + context },
          ...pastMessages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI API error:", response.status, errText);
      return NextResponse.json({ error: "AI応答の取得に失敗しました" }, { status: 500 });
    }

    const data = await response.json();
    const aiContent = data.choices?.[0]?.message?.content || "応答を取得できませんでした";

    // AI応答保存
    const saved = await prisma.advisorChatMessage.create({
      data: { sessionId, role: "assistant", content: aiContent },
    });

    // セッション更新日時を更新
    await prisma.advisorChatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({ message: saved });
  } catch (e) {
    console.error("OpenAI API call error:", e);
    return NextResponse.json({ error: "AI応答の取得に失敗しました" }, { status: 500 });
  }
}
