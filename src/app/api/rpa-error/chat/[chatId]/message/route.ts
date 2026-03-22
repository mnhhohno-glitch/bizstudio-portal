import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "@/lib/rpa-error/system-prompt";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { chatId } = await params;
  const { content } = await req.json();

  if (!content?.trim()) {
    return NextResponse.json({ error: "メッセージは必須です" }, { status: 400 });
  }

  // ユーザーメッセージ保存
  await prisma.rpaErrorChatMessage.create({
    data: { chatId, role: "user", content: content.trim() },
  });

  // チャット履歴取得
  const messages = await prisma.rpaErrorChatMessage.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
  });

  // Claude API呼び出し
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 500 });
  }

  const client = new Anthropic({ apiKey });
  const systemPrompt = await buildSystemPrompt();

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    const assistantContent =
      response.content[0].type === "text" ? response.content[0].text : "";

    // アシスタントメッセージ保存
    const saved = await prisma.rpaErrorChatMessage.create({
      data: { chatId, role: "assistant", content: assistantContent },
    });

    return NextResponse.json({
      message: { id: saved.id, role: "assistant", content: assistantContent },
    });
  } catch (e) {
    console.error("Claude API error:", e);
    return NextResponse.json({ error: "AI応答の取得に失敗しました" }, { status: 500 });
  }
}
