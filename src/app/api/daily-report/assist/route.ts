// T-069③：日報AIアシスト。CAの所感（■1〜■6）＋当日集計を受け、6項目構造を保った整理本文＋上司視点アドバイスを返す。
// - Claude（claude-sonnet-4-6・既存日報/スケジュールと同じ）。Gemini は使わない。
// - 日報skill＋job-matching-advisor skill を system に注入（cache_control: ephemeral）。
// - 数字は集計値のみ渡す（AIに計算・捏造させない）。会話は DailyReportChat に保存。
// - 旧 /api/daily-report/chat（aiBody 用ドロワー）は触らない。別ルート。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { anthropic, CLAUDE_MODEL_DEFAULT } from "@/lib/claude";
import { recordAdvisorUsage } from "@/lib/advisor-usage";
import { getDailyReportSkill } from "@/lib/load-daily-report-skill";
import { getJobMatchingSkillFull } from "@/lib/load-job-matching-skill";
import { computeWeeklyMatrix } from "@/lib/performance/weeklyMatrix";
import { computeJobSearchDay } from "@/lib/dailyReport/jobSearch";
import { resolveDailyReportFormat, formatHasNumbers } from "@/lib/dailyReport/constants";
import { jstDateStart, jstDateEnd, jstDateStringToDbDate, todayJstDateString } from "@/lib/dailyReport/jstDate";
import { buildAssistContext, ASSIST_INSTRUCTION, type AssistContext } from "@/lib/dailyReport/assistPrompt";

type Parsed = { message: string; rewrittenBody: string; advice: string };

function tryParse(text: string): Parsed | null {
  try {
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const o = JSON.parse(cleaned);
    if (typeof o?.message === "string" && typeof o?.rewrittenBody === "string" && typeof o?.advice === "string") return o as Parsed;
    return null;
  } catch { return null; }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 500 });

  const body = (await req.json()) as {
    date?: string;
    reportBody?: string;
    message: string;
    chatHistory?: { role: "user" | "assistant"; content: string }[];
  };
  if (!body.message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  const dateStr = body.date ?? todayJstDateString();
  const dbDate = jstDateStringToDbDate(dateStr);

  const employee = await prisma.employee.findFirst({
    where: { name: user.name, status: "active" },
    select: { id: true, jobCategory: true },
  });
  const format = resolveDailyReportFormat(employee?.jobCategory ?? null);
  const employeeId = employee?.id ?? "__nonexistent__";

  // 当日集計（システム算出値のみ。AI には数字として渡す）。CA 以外は数値なし。
  const from = jstDateStart(dateStr);
  const to = jstDateEnd(dateStr);
  let mx = null as Awaited<ReturnType<typeof computeWeeklyMatrix>> | null;
  let js = null as Awaited<ReturnType<typeof computeJobSearchDay>> | null;
  let activeCandidates = 0;
  if (formatHasNumbers(format)) {
    const [m, j, ac] = await Promise.all([
      computeWeeklyMatrix({ employeeId, userId: user.id, from, to }),
      computeJobSearchDay(user.id, dateStr),
      prisma.candidate.count({ where: { employeeId, supportStatus: "ACTIVE" } }),
    ]);
    mx = m; js = j; activeCandidates = ac;
  }

  const schedule = await prisma.dailySchedule.findUnique({
    where: { userId_date: { userId: user.id, date: dbDate } },
    include: { entries: true },
  });
  const planned = schedule?.entries.length ?? 0;
  const completed = schedule?.entries.filter((e) => e.isCompleted).length ?? 0;

  const ctx: AssistContext = {
    caName: user.name,
    dateStr,
    interviewTotal: mx?.interview.total ?? 0,
    interviewFirst: mx?.interview.first ?? 0,
    interviewExisting: mx ? mx.interview.second + mx.interview.thirdPlus : 0,
    proposalUniq: mx?.proposal.total.uniq ?? 0,
    entryTotal: mx?.entry.total.uniq ?? 0,
    entryRate: mx && mx.proposal.total.uniq > 0 ? mx.entry.total.uniq / mx.proposal.total.uniq : null,
    bmCount: js?.bmCount ?? 0,
    exportCount: js?.exportCount ?? 0,
    selectionRate: js?.selectionRate ?? null,
    dCount: js?.ratings["D"] ?? 0,
    activeCandidates,
    plannedCount: planned,
    completedCount: completed,
    reportBody: body.reportBody ?? "",
  };

  // skill を system に注入（日報skill＋求人選定skill）。cache_control で再利用。
  const skillText = `${getDailyReportSkill()}\n\n---\n\n# 付録: 求人選定の知見（job-matching-advisor）\n\n${getJobMatchingSkillFull()}`;
  const systemBlocks = [
    { type: "text" as const, text: skillText, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: `${ASSIST_INSTRUCTION}\n\n${buildAssistContext(ctx)}` },
  ];
  const messages = [
    ...(body.chatHistory ?? []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: body.message },
  ];

  let assistantText = "";
  try {
    const res = await anthropic.messages.create({
      model: CLAUDE_MODEL_DEFAULT,
      max_tokens: 4096,
      system: systemBlocks,
      messages,
    });
    assistantText = res.content[0]?.type === "text" ? res.content[0].text : "";
    // T-126: usage を永続化。
    await recordAdvisorUsage({ endpoint: "daily-report-assist", model: CLAUDE_MODEL_DEFAULT, usage: res.usage });
  } catch (e) {
    console.error("[daily-report/assist] Claude error:", e);
    return NextResponse.json({ error: "AI の応答取得に失敗しました" }, { status: 500 });
  }

  let parsed = tryParse(assistantText);
  if (!parsed) {
    try {
      const retry = await anthropic.messages.create({
        model: CLAUDE_MODEL_DEFAULT,
        max_tokens: 4096,
        system: systemBlocks,
        messages: [
          ...messages,
          { role: "assistant", content: assistantText },
          { role: "user", content: '前回のレスポンスが JSON 形式ではありませんでした。必ず { "message": "...", "rewrittenBody": "...", "advice": "..." } の形式で返してください。コードブロック記法は使わないでください。' },
        ],
      });
      // T-126: JSON 整形リトライも記録（isRetry=true）。
      await recordAdvisorUsage({ endpoint: "daily-report-assist", model: CLAUDE_MODEL_DEFAULT, usage: retry.usage, isRetry: true, note: "json-retry" });
      parsed = tryParse(retry.content[0]?.type === "text" ? retry.content[0].text : "");
    } catch (e) { console.error("[daily-report/assist] retry failed:", e); }
  }
  if (!parsed) {
    return NextResponse.json({ message: "応答の解析に失敗しました。もう一度試してください。", rewrittenBody: "", advice: "" });
  }

  // 会話履歴を DailyReportChat に保存（日報行が無ければ DRAFT を作って id を得る。reportBody/確定は変えない）。
  try {
    const report = await prisma.dailyReport.upsert({
      where: { userId_date: { userId: user.id, date: dbDate } },
      create: { userId: user.id, date: dbDate, jobCategory: employee?.jobCategory ?? null, status: "DRAFT" },
      update: {},
      select: { id: true },
    });
    await prisma.dailyReportChat.createMany({
      data: [
        { dailyReportId: report.id, role: "USER", content: body.message },
        { dailyReportId: report.id, role: "ASSISTANT", content: JSON.stringify(parsed) },
      ],
    });
  } catch (e) { console.error("[daily-report/assist] history save failed:", e); }

  return NextResponse.json(parsed);
}
