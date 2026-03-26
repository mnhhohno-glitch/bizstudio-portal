import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { anthropic } from "@/lib/claude";
import { buildScheduleSystemPrompt } from "@/lib/schedulePrompt";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const {
    scheduleId,
    date,
    message,
    calendarEvents = [],
    existingEntries = [],
    chatHistory = [],
  } = body as {
    scheduleId: string | null;
    date: string;
    message: string;
    calendarEvents: { summary: string; start: string; end: string }[];
    existingEntries: { startTime: string; endTime: string; title: string; tag: string }[];
    chatHistory: { role: string; content: string }[];
  };

  if (!message || !date) {
    return NextResponse.json({ error: "message and date are required" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 500 });
  }

  const systemPrompt = buildScheduleSystemPrompt(calendarEvents, existingEntries);

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
    console.error("Claude API error:", e);
    return NextResponse.json({ error: "AIの応答取得に失敗しました" }, { status: 500 });
  }

  // Parse JSON response
  let parsed: { message: string; entries: unknown[] };
  try {
    const cleanJson = assistantText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    parsed = JSON.parse(cleanJson);
  } catch {
    // Retry once with instruction
    try {
      const retryResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          ...messages,
          { role: "assistant" as const, content: assistantText },
          { role: "user" as const, content: "前回のレスポンスがJSON形式ではありませんでした。必ず { \"message\": \"...\", \"entries\": [...] } の形式で返してください。マークダウンのコードブロック記法は使わないでください。" },
        ],
      });
      const retryText = retryResponse.content[0].type === "text" ? retryResponse.content[0].text : "";
      const retryClean = retryText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      parsed = JSON.parse(retryClean);
    } catch {
      console.error("Claude JSON parse failed after retry. Raw:", assistantText);
      return NextResponse.json({
        message: "スケジュールの解析に失敗しました。もう少し具体的に指示してみてください。",
        entries: existingEntries.map((e, i) => ({ ...e, note: null, tagColor: "#6B7280", sortOrder: i })),
      });
    }
  }

  // Save chat history to DB
  if (scheduleId) {
    try {
      await prisma.scheduleChat.createMany({
        data: [
          { dailyScheduleId: scheduleId, role: "USER", content: message },
          { dailyScheduleId: scheduleId, role: "ASSISTANT", content: JSON.stringify(parsed) },
        ],
      });
    } catch (e) {
      console.error("Chat history save error:", e);
    }
  }

  return NextResponse.json({
    message: parsed.message,
    entries: parsed.entries,
  });
}
