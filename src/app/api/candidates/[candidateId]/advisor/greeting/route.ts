import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

const API_TIMEOUT_MS = 120000;

function buildSystemPrompt(format: "line" | "email"): string {
  const formatInstructions =
    format === "line"
      ? `LINE向けの挨拶文を作成してください。
- 件名は不要です
- カジュアルすぎず、丁寧すぎない文体
- 適度に改行を入れて読みやすくしてください
- 長さは300〜500文字程度`
      : `メール向けの挨拶文を作成してください。
- 件名を含めてください（「件名：○○」の形式）
- ビジネスメールとして適切な文体
- 適度に段落を分けてください
- 長さは400〜700文字程度`;

  return `あなたは人材紹介会社「株式会社ビズスタジオ」のキャリアアドバイザーのアシスタントです。
面談後に求職者へ送る挨拶文を作成してください。

## 挨拶文の作成ルール

1. 【会話内容の理解】
   以下のチャット履歴と面談ログを確認し、面談で話された内容を正確に把握してください。

2. 【次回面談日の確認】
   - チャット履歴や面談ログに次回面談日の記載がある場合は、挨拶文に日時を明記してください
   - 次回面談日の記載がない場合は、「次回のお打ち合わせ日程については、改めてご連絡させていただきます」と記載してください

3. 【面談所感の書き方】
   - 経歴や実績を過度に褒めないでください
   - 会話の中で話された内容や、求職者の志向性・価値観に寄り添う形で書いてください
   - 柔らかく温かみのあるトーンで書いてください
   - 具体的な会話内容に触れることで、きちんと話を聞いていたことが伝わるようにしてください

4. 【フォーマット】
   ${formatInstructions}

5. 【署名】
   文末に以下の署名を入れてください:
   株式会社ビズスタジオ
   担当: [担当CA名]`;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const body = await req.json();
  const { format, sessionId } = body as { format: string; sessionId: string };

  if (!format || !["line", "email"].includes(format)) {
    return NextResponse.json({ error: "format must be 'line' or 'email'" }, { status: 400 });
  }
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  // Get chat history
  const chatMessages = await prisma.advisorChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });

  const chatHistory = chatMessages
    .map((m) => `${m.role === "user" ? "CA" : "AI"}: ${m.content}`)
    .join("\n\n");

  // Get context via internal fetch to context API
  let contextData = "";
  try {
    const contextRes = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/candidates/${candidateId}/advisor/context`,
      {
        headers: { cookie: req.headers.get("cookie") || "" },
      }
    );
    if (contextRes.ok) {
      const contextJson = await contextRes.json();
      contextData = contextJson.context || "";
    }
  } catch (e) {
    console.error("Greeting context fetch error:", e);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY が未設定です" }, { status: 500 });
  }

  const systemPrompt = buildSystemPrompt(format as "line" | "email");
  const userContent = `## 求職者情報\n${contextData}\n\n## これまでのチャット履歴\n${chatHistory}\n\n上記の情報をもとに、${format === "line" ? "LINE" : "メール"}向けの面談後挨拶文を作成してください。`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

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
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.7,
        max_completion_tokens: 16000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.error("Greeting OpenAI API error:", response.status, errText);
      return NextResponse.json({ error: "挨拶文の生成に失敗しました" }, { status: 500 });
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    const greetingText = rawContent && rawContent.trim() !== ""
      ? rawContent
      : "挨拶文の生成に失敗しました。もう一度お試しください。";

    const label = format === "line" ? "【LINE向け挨拶文】" : "【メール向け挨拶文】";
    const fullContent = `${label}\n\n${greetingText}`;

    const saved = await prisma.advisorChatMessage.create({
      data: { sessionId, role: "assistant", content: fullContent },
    });

    await prisma.advisorChatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({
      greeting: greetingText,
      format,
      messageId: saved.id,
    });
  } catch (e: unknown) {
    clearTimeout(timeoutId);

    if (e instanceof Error && e.name === "AbortError") {
      console.error("Greeting OpenAI API timeout after", API_TIMEOUT_MS, "ms");
      return NextResponse.json({ error: "タイムアウトしました" }, { status: 504 });
    }

    console.error("Greeting OpenAI API call error:", e);
    return NextResponse.json({ error: "挨拶文の生成に失敗しました" }, { status: 500 });
  }
}
