import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { chatId } = await params;
  const messages = await prisma.rpaErrorChatMessage.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
  });

  if (messages.length === 0) {
    return NextResponse.json({ error: "チャット履歴がありません" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 500 });
  }

  // 既知エラーDB取得
  const knownErrors = await prisma.rpaKnownError.findMany();

  const knownErrorsList = knownErrors.map((e) =>
    `ID: ${e.id} | パターン名: ${e.patternName} | キーワード: ${e.keywords.join(",")} | 深刻度: ${e.severity}`
  ).join("\n");

  const chatText = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: `以下のチャット履歴から、RPAエラーの情報を抽出してJSON形式で返してください。
号機は1〜7の数字、フロー名は「00.スカウトメール送信」（1〜6号機）または「01.応募者一次返信・情報取り込み」（7号機）です。

既知エラーDB:
${knownErrorsList || "（なし）"}

以下のJSON形式のみで返してください（説明文不要）:
{"machineNumber": number, "flowName": string, "errorSummary": string, "severity": string|null, "knownErrorId": string|null}`,
      messages: [{ role: "user", content: chatText }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    // JSONを抽出
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    return NextResponse.json(extracted);
  } catch (e) {
    console.error("Extract error:", e);
    return NextResponse.json({ error: "抽出に失敗しました" }, { status: 500 });
  }
}
