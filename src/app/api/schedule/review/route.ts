import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { anthropic } from "@/lib/claude";
import { buildReviewSystemPrompt } from "@/lib/schedulePrompt";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const {
    scheduleId,
    message,
    chatHistory = [],
    todayEntries = [],
    tomorrowCalendarEvents = [],
  } = body as {
    scheduleId: string;
    message: string;
    chatHistory: { role: string; content: string }[];
    todayEntries: { title: string; isCompleted: boolean; startTime: string; endTime: string; tag: string }[];
    tomorrowCalendarEvents: { summary: string; start: string; end: string }[];
  };

  if (!message || !scheduleId) {
    return NextResponse.json({ error: "message and scheduleId are required" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 500 });
  }

  const systemPrompt = buildReviewSystemPrompt(todayEntries, tomorrowCalendarEvents);

  const messages = [
    ...chatHistory.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    })),
    { role: "user" as const, content: message },
  ];

  let assistantText = "";
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    });
    assistantText = response.content[0].type === "text" ? response.content[0].text : "";
  } catch (e) {
    console.error("Review Claude API error:", e);
    return NextResponse.json({ error: "AIの応答取得に失敗しました" }, { status: 500 });
  }

  let parsed: { message: string; phase: string; review: string | null; tomorrowEntries: unknown[] };
  try {
    const cleanJson = assistantText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    parsed = JSON.parse(cleanJson);
  } catch {
    // Retry once
    try {
      const retryResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          ...messages,
          { role: "assistant" as const, content: assistantText },
          { role: "user" as const, content: "前回のレスポンスがJSON形式ではありませんでした。必ず { \"message\": \"...\", \"phase\": \"...\", \"review\": ..., \"tomorrowEntries\": [...] } の形式で返してください。" },
        ],
      });
      const retryText = retryResponse.content[0].type === "text" ? retryResponse.content[0].text : "";
      const retryClean = retryText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      parsed = JSON.parse(retryClean);
    } catch {
      return NextResponse.json({
        message: "応答の解析に失敗しました。もう一度お試しください。",
        phase: "REVIEW",
        review: null,
        tomorrowEntries: [],
      });
    }
  }

  // Save chat history
  try {
    await prisma.scheduleChat.createMany({
      data: [
        { dailyScheduleId: scheduleId, role: "USER", content: message, chatType: "REVIEW" },
        { dailyScheduleId: scheduleId, role: "ASSISTANT", content: JSON.stringify(parsed), chatType: "REVIEW" },
      ],
    });
  } catch (e) {
    console.error("Review chat history save error:", e);
  }

  return NextResponse.json(parsed);
}
