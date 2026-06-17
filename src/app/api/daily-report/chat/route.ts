// T-066: 日報 AI チャット。
// - model は claude-sonnet-4 固定（schedule/chat と揃える / R5）。
// - JSON 厳格パース、失敗時に 1 回だけリトライ。
// - DailyReportChat に履歴保存。
// - AI に生レコードを渡さない（仕様 #10）：buildDailyReportSystemPrompt に渡るのは
//   metrics.ts で算出済みの集計値と予実サマリのみ。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { anthropic } from "@/lib/claude";
import { buildDailyReportSystemPrompt } from "@/lib/dailyReport/prompt";
import { computeCaMetrics } from "@/lib/dailyReport/metrics";
import {
  formatHasNumbers,
  resolveDailyReportFormat,
} from "@/lib/dailyReport/constants";
import {
  jstDateStringToDbDate,
  todayJstDateString,
} from "@/lib/dailyReport/jstDate";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json()) as {
    date?: string;
    message: string;
    comment?: string;
    chatHistory?: { role: "user" | "assistant"; content: string }[];
  };

  if (!body.message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 500 });
  }

  const dateStr = body.date ?? todayJstDateString();
  const dbDate = jstDateStringToDbDate(dateStr);

  // 職種解決
  const employee = await prisma.employee.findFirst({
    where: { name: user.name, status: "active" },
    select: { id: true, jobCategory: true },
  });
  const format = resolveDailyReportFormat(employee?.jobCategory ?? null);

  // 予実サマリ
  const schedule = await prisma.dailySchedule.findUnique({
    where: { userId_date: { userId: user.id, date: dbDate } },
    include: { entries: { orderBy: { startTime: "asc" } } },
  });
  const entries = schedule?.entries ?? [];
  const scheduleSummary = {
    plannedCount: entries.length,
    completedCount: entries.filter((e) => e.isCompleted).length,
    highlights: entries.slice(0, 12).map((e) => ({
      title: e.title,
      time: `${e.startTime}〜${e.endTime}`,
      status: e.isCompleted ? ("完了" as const) : ("未完了" as const),
    })),
  };

  // CA だけ集計
  const metrics = formatHasNumbers(format)
    ? await computeCaMetrics({
        userId: user.id,
        employeeId: employee?.id ?? null,
        dateStr,
      })
    : null;

  const systemPrompt = buildDailyReportSystemPrompt({
    userName: user.name,
    dateStr,
    format,
    schedule: scheduleSummary,
    metrics,
    comment: body.comment ?? "",
  });

  const messages = [
    ...(body.chatHistory ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: "user" as const, content: body.message },
  ];

  let assistantText = "";
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    });
    assistantText = response.content[0]?.type === "text" ? response.content[0].text : "";
  } catch (e) {
    console.error("[daily-report/chat] Claude API error:", e);
    return NextResponse.json({ error: "AI の応答取得に失敗しました" }, { status: 500 });
  }

  // JSON 厳格パース + 1 回リトライ
  let parsed: { message: string; report: string } | null = null;
  const tryParse = (text: string): { message: string; report: string } | null => {
    try {
      const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const obj = JSON.parse(cleaned);
      if (typeof obj?.message === "string" && typeof obj?.report === "string") {
        return obj as { message: string; report: string };
      }
      return null;
    } catch {
      return null;
    }
  };

  parsed = tryParse(assistantText);
  if (!parsed) {
    try {
      const retry = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          ...messages,
          { role: "assistant", content: assistantText },
          {
            role: "user",
            content:
              "前回のレスポンスが JSON 形式ではありませんでした。必ず { \"message\": \"...\", \"report\": \"...\" } の形式で返してください。コードブロック記法は使わないでください。",
          },
        ],
      });
      const retryText = retry.content[0]?.type === "text" ? retry.content[0].text : "";
      parsed = tryParse(retryText);
    } catch (e) {
      console.error("[daily-report/chat] retry failed:", e);
    }
  }

  if (!parsed) {
    return NextResponse.json({
      message: "応答の解析に失敗しました。もう一度試してください。",
      report: "",
    });
  }

  // DailyReport upsert + chat 履歴保存
  const report = await prisma.dailyReport.upsert({
    where: { userId_date: { userId: user.id, date: dbDate } },
    create: {
      userId: user.id,
      date: dbDate,
      jobCategory: employee?.jobCategory ?? null,
      numbers: metrics ? (metrics as unknown as object) : undefined,
      comment: body.comment ?? null,
      aiBody: parsed.report,
      status: "DRAFT",
    },
    update: {
      jobCategory: employee?.jobCategory ?? null,
      numbers: metrics ? (metrics as unknown as object) : undefined,
      comment: body.comment ?? null,
      aiBody: parsed.report,
    },
  });

  try {
    await prisma.dailyReportChat.createMany({
      data: [
        { dailyReportId: report.id, role: "USER", content: body.message },
        { dailyReportId: report.id, role: "ASSISTANT", content: JSON.stringify(parsed) },
      ],
    });
  } catch (e) {
    console.error("[daily-report/chat] history save failed:", e);
  }

  return NextResponse.json({
    message: parsed.message,
    report: parsed.report,
    reportId: report.id,
  });
}
