// T-066: 日報の CRUD（読み取り＋下書き保存 / 確定）。
// 数値は metrics.ts で都度集計してスナップショットを numbers(Json) に保存する。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { computeCaMetrics, type CaDailyMetrics } from "@/lib/dailyReport/metrics";
import { computeWeeklyMatrix, type WeeklyMatrix } from "@/lib/performance/weeklyMatrix";
import { computeInterviewAttributes, type InterviewAttributes } from "@/lib/performance/attributes";
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

// "YYYY-MM-DD"（JST）の翌日を返す。
function nextJstDateString(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map((s) => parseInt(s, 10));
  const next = new Date(Date.UTC(y, m - 1, d) + 24 * 60 * 60 * 1000);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

// 求人検索の行動量・精度（当日・担当 uploadedByUserId）。
// ⚠️ グラフ専用集計：archivedAt 条件を**付けない**（紹介保留＝BOOKMARK+archivedAt のため、
//    archivedAt=null だと D の 77% が保留に逃げて選定率が常時100%になる）。既存 metrics.ts の
//    jobSearched/jobIntroduced（archivedAt=null）とは別物。D は aiMatchRating の実値で判定。
async function computeJobSearchDay(userId: string, dateStr: string) {
  const counts = await prisma.$queryRawUnsafe<{ bm: number; exp: number }[]>(`
    SELECT
      COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date = DATE '${dateStr}')::int bm,
      COUNT(*) FILTER (WHERE (last_exported_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date = DATE '${dateStr}')::int exp
    FROM candidate_files
    WHERE category = 'BOOKMARK' AND uploaded_by_user_id = '${userId}'`);
  const ratingRows = await prisma.$queryRawUnsafe<{ r: string; n: number }[]>(`
    SELECT COALESCE(NULLIF(ai_match_rating,''),'未評価') r, COUNT(*)::int n
    FROM candidate_files
    WHERE category = 'BOOKMARK' AND uploaded_by_user_id = '${userId}'
      AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date = DATE '${dateStr}'
    GROUP BY r`);
  const ratings: Record<string, number> = {};
  for (const row of ratingRows) ratings[row.r] = row.n;
  const bmCount = counts[0]?.bm ?? 0;
  const abc = (ratings["A"] ?? 0) + (ratings["B"] ?? 0) + (ratings["C"] ?? 0);
  // 選定率＝(A+B+C)÷合計BM。D・未評価は分子から除外（見る目の指標として D を母数に含める）。
  const selectionRate = bmCount > 0 ? abc / bmCount : null;
  return { bmCount, exportCount: counts[0]?.exp ?? 0, ratings, selectionRate };
}

// 当日のスケジュール entries（予定）と完了（実績）を返す。
async function buildScheduleEntries(userId: string, dateStr: string) {
  const schedule = await prisma.dailySchedule.findUnique({
    where: { userId_date: { userId, date: jstDateStringToDbDate(dateStr) } },
    include: { entries: { orderBy: { startTime: "asc" } } },
  });
  return (schedule?.entries ?? []).map((e) => ({
    id: e.id,
    startTime: e.startTime,
    endTime: e.endTime,
    title: e.title,
    tag: e.tag,
    tagColor: e.tagColor,
    isCompleted: e.isCompleted,
  }));
}

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
  let dayMatrix: WeeklyMatrix | null = null;
  let attributes: InterviewAttributes | null = null;
  let jobSearch: Awaited<ReturnType<typeof computeJobSearchDay>> | null = null;
  if (formatHasNumbers(actor.format)) {
    const from = jstDateStart(dateStr);
    const to = jstDateEnd(dateStr);
    [metrics, dayMatrix, attributes, jobSearch] = await Promise.all([
      computeCaMetrics({ userId: user.id, employeeId: actor.employeeId, dateStr }),
      computeWeeklyMatrix({ employeeId: actor.employeeId ?? "__nonexistent__", userId: user.id, from, to }),
      computeInterviewAttributes({ employeeId: actor.employeeId ?? "__nonexistent__", from, to }),
      computeJobSearchDay(user.id, dateStr),
    ]);
  }

  // 当日の予定/実績エントリ＋明日の予定。
  const tomorrowStr = nextJstDateString(dateStr);
  const [todayEntries, tomorrowEntries] = await Promise.all([
    buildScheduleEntries(user.id, dateStr),
    buildScheduleEntries(user.id, tomorrowStr),
  ]);

  return NextResponse.json({
    date: dateStr,
    tomorrowDate: tomorrowStr,
    format: actor.format,
    jobCategory: actor.jobCategory,
    report: existing,
    scheduleSummary: scheduleData.summary,
    scheduleEntries: todayEntries,
    tomorrowEntries,
    metrics,
    dayMatrix,
    attributes,
    jobSearch,
  });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json()) as {
    date?: string;
    comment?: string;
    aiBody?: string;
    scheduleNote?: string;
    metricsReflection?: string;
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
      scheduleNote: body.scheduleNote ?? null,
      metricsReflection: body.metricsReflection ?? null,
      status: submit ? "SUBMITTED" : "DRAFT",
      submittedAt: submit ? new Date() : null,
    },
    update: {
      jobCategory: actor.jobCategory,
      numbers: metrics ? (metrics as unknown as object) : undefined,
      comment: body.comment ?? null,
      aiBody: body.aiBody ?? null,
      scheduleNote: body.scheduleNote ?? null,
      metricsReflection: body.metricsReflection ?? null,
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
