// T-066: 日報の CRUD（読み取り＋下書き保存 / 確定）。
// 数値は metrics.ts で都度集計してスナップショットを numbers(Json) に保存する。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { computeCaMetrics, type CaDailyMetrics } from "@/lib/dailyReport/metrics";
import {
  formatHasNumbers,
  resolveDailyReportFormat,
} from "@/lib/dailyReport/constants";
import {
  jstDateStart,
  jstDateEnd,
  jstDateStringToDbDate,
  todayJstDateString,
} from "@/lib/dailyReport/jstDate";

async function resolveActor(userId: string, userName: string) {
  const employee = await prisma.employee.findFirst({
    where: { name: userName, status: "active" },
    select: { id: true, jobCategory: true },
  });
  const format = resolveDailyReportFormat(employee?.jobCategory ?? null);
  return { employeeId: employee?.id ?? null, jobCategory: employee?.jobCategory ?? null, format };
}

async function buildScheduleSummary(userId: string, dateStr: string) {
  const date = jstDateStringToDbDate(dateStr);
  const schedule = await prisma.dailySchedule.findUnique({
    where: { userId_date: { userId, date } },
    include: {
      entries: { orderBy: { startTime: "asc" } },
    },
  });
  const entries = schedule?.entries ?? [];
  const planned = entries.length;
  const completed = entries.filter((e) => e.isCompleted).length;
  return {
    schedule,
    summary: {
      plannedCount: planned,
      completedCount: completed,
      highlights: entries.slice(0, 12).map((e) => ({
        title: e.title,
        time: `${e.startTime}〜${e.endTime}`,
        status: e.isCompleted ? ("完了" as const) : ("未完了" as const),
      })),
    },
  };
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get("date") ?? todayJstDateString();

  const actor = await resolveActor(user.id, user.name);
  const dbDate = jstDateStringToDbDate(dateStr);

  const [existing, scheduleData] = await Promise.all([
    prisma.dailyReport.findUnique({
      where: { userId_date: { userId: user.id, date: dbDate } },
      include: {
        chats: { orderBy: { createdAt: "asc" } },
      },
    }),
    buildScheduleSummary(user.id, dateStr),
  ]);

  let metrics: CaDailyMetrics | null = null;
  if (formatHasNumbers(actor.format)) {
    metrics = await computeCaMetrics({
      userId: user.id,
      employeeId: actor.employeeId,
      dateStr,
    });
  }

  return NextResponse.json({
    date: dateStr,
    format: actor.format,
    jobCategory: actor.jobCategory,
    report: existing,
    scheduleSummary: scheduleData.summary,
    metrics,
  });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json()) as {
    date?: string;
    comment?: string;
    aiBody?: string;
    submit?: boolean;
  };

  const dateStr = body.date ?? todayJstDateString();
  const dbDate = jstDateStringToDbDate(dateStr);
  const actor = await resolveActor(user.id, user.name);

  let metrics: CaDailyMetrics | null = null;
  if (formatHasNumbers(actor.format)) {
    metrics = await computeCaMetrics({
      userId: user.id,
      employeeId: actor.employeeId,
      dateStr,
    });
  }

  const submit = Boolean(body.submit);
  const report = await prisma.dailyReport.upsert({
    where: { userId_date: { userId: user.id, date: dbDate } },
    create: {
      userId: user.id,
      date: dbDate,
      jobCategory: actor.jobCategory,
      numbers: metrics ? (metrics as unknown as object) : undefined,
      comment: body.comment ?? null,
      aiBody: body.aiBody ?? null,
      status: submit ? "SUBMITTED" : "DRAFT",
      submittedAt: submit ? new Date() : null,
    },
    update: {
      jobCategory: actor.jobCategory,
      numbers: metrics ? (metrics as unknown as object) : undefined,
      comment: body.comment ?? null,
      aiBody: body.aiBody ?? null,
      status: submit ? "SUBMITTED" : "DRAFT",
      submittedAt: submit ? new Date() : null,
    },
  });

  return NextResponse.json({ report });
}

// 開発用：JST 当日窓の sanity check に使う（4-4 の罠 #17 で誤った窓を切らないか確認）。
export const _internalJstWindow = (dateStr: string) => ({
  start: jstDateStart(dateStr).toISOString(),
  end: jstDateEnd(dateStr).toISOString(),
});
