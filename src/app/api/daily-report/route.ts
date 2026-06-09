// T-066: 日報の CRUD（読み取り＋下書き保存 / 確定）。
// 数値は metrics.ts で都度集計してスナップショットを numbers(Json) に保存する。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { computeCaMetrics, type CaDailyMetrics } from "@/lib/dailyReport/metrics";
import { computeWeeklyMatrix, type WeeklyMatrix } from "@/lib/performance/weeklyMatrix";
import { computeInterviewAttributes, type InterviewAttributes } from "@/lib/performance/attributes";
import { computeJobSearchDay } from "@/lib/dailyReport/jobSearch";
import { notifyDailyReport } from "@/lib/dailyReport/lineworks-notify";
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

  // T-085: userId 指定時はそのユーザーの日報を閲覧（ログイン済みなら誰でも可）。
  //        省略時はログインユーザー自身（後方互換 100%）。
  const queryUserId = searchParams.get("userId");
  const targetUserId = queryUserId && queryUserId.trim() ? queryUserId : user.id;
  const isSelf = targetUserId === user.id;

  // 閲覧対象ユーザーの表示情報（name・職種→format）を解決。
  const targetUser = isSelf
    ? { id: user.id, name: user.name }
    : await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, name: true } });
  if (!targetUser) return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });

  const actor = await resolveActor(targetUser.id, targetUser.name);
  const dbDate = jstDateStringToDbDate(dateStr);

  const [existing, scheduleData] = await Promise.all([
    prisma.dailyReport.findUnique({
      where: { userId_date: { userId: targetUser.id, date: dbDate } },
      include: {
        chats: { orderBy: { createdAt: "asc" } },
        comments: {
          orderBy: { createdAt: "asc" },
          include: { user: { select: { id: true, name: true } } },
        },
      },
    }),
    buildScheduleSummary(targetUser.id, dateStr),
  ]);

  let metrics: CaDailyMetrics | null = null;
  let dayMatrix: WeeklyMatrix | null = null;
  let attributes: InterviewAttributes | null = null;
  let jobSearch: Awaited<ReturnType<typeof computeJobSearchDay>> | null = null;
  if (formatHasNumbers(actor.format)) {
    const from = jstDateStart(dateStr);
    const to = jstDateEnd(dateStr);
    [metrics, dayMatrix, attributes, jobSearch] = await Promise.all([
      computeCaMetrics({ userId: targetUser.id, employeeId: actor.employeeId, dateStr }),
      computeWeeklyMatrix({ employeeId: actor.employeeId ?? "__nonexistent__", userId: targetUser.id, from, to }),
      computeInterviewAttributes({ employeeId: actor.employeeId ?? "__nonexistent__", from, to }),
      computeJobSearchDay(targetUser.id, dateStr),
    ]);
  }

  // 当日の予定/実績エントリ＋明日の予定。
  const tomorrowStr = nextJstDateString(dateStr);
  const [todayEntries, tomorrowEntries] = await Promise.all([
    buildScheduleEntries(targetUser.id, dateStr),
    buildScheduleEntries(targetUser.id, tomorrowStr),
  ]);

  // コメント一覧（投稿者名つき）。report が無ければ空配列。
  const comments = (existing?.comments ?? []).map((c) => ({
    id: c.id,
    body: c.body,
    userId: c.userId,
    userName: c.user?.name ?? "",
    createdAt: c.createdAt,
  }));

  return NextResponse.json({
    date: dateStr,
    tomorrowDate: tomorrowStr,
    format: actor.format,
    jobCategory: actor.jobCategory,
    // T-085: 閲覧対象ユーザー・閲覧モード判定用情報。
    viewUserId: targetUser.id,
    viewUserName: targetUser.name,
    isSelf,
    report: existing,
    comments,
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
    userId?: string; // T-085: 本人ガード用（指定があっても本人のみ許可）
    comment?: string;
    aiBody?: string;
    scheduleNote?: string;
    metricsReflection?: string;
    reportBody?: string;
    confirmComment?: boolean; // 「確定」操作。commentConfirmedAt をセット
    submit?: boolean;
  };

  // T-085: 編集・提出は本人のみ。他人の日報への書き込み経路を物理的に塞ぐ（閲覧モードからの誤書き込み防止）。
  if (body.userId && body.userId !== user.id) {
    return NextResponse.json({ error: "他人の日報は編集できません（閲覧のみ可）" }, { status: 403 });
  }

  const dateStr = body.date ?? todayJstDateString();
  const dbDate = jstDateStringToDbDate(dateStr);
  const actor = await resolveActor(user.id, user.name);

  const submit = Boolean(body.submit);

  // 提出は「コメント確定済み」が前提（未確定では弾く。フロントも提出ボタンを disabled）。
  if (submit) {
    const cur = await prisma.dailyReport.findUnique({
      where: { userId_date: { userId: user.id, date: dbDate } },
      select: { commentConfirmedAt: true },
    });
    if (!cur?.commentConfirmedAt && !body.confirmComment) {
      return NextResponse.json({ error: "コメントを確定してから提出してください" }, { status: 400 });
    }
  }

  let metrics: CaDailyMetrics | null = null;
  if (formatHasNumbers(actor.format)) {
    metrics = await computeCaMetrics({ userId: user.id, employeeId: actor.employeeId, dateStr });
  }

  // update は body に来たフィールドのみ反映（undefined 据え置き＝旧 comment/aiBody を潰さない）。
  const update: Record<string, unknown> = {
    jobCategory: actor.jobCategory,
    status: submit ? "SUBMITTED" : "DRAFT",
    submittedAt: submit ? new Date() : null,
  };
  if (metrics) update.numbers = metrics as unknown as object;
  if (body.comment !== undefined) update.comment = body.comment;
  if (body.aiBody !== undefined) update.aiBody = body.aiBody;
  if (body.scheduleNote !== undefined) update.scheduleNote = body.scheduleNote;
  if (body.metricsReflection !== undefined) update.metricsReflection = body.metricsReflection;
  if (body.reportBody !== undefined) update.reportBody = body.reportBody;
  // 確定/未確定の制御：confirm=true で確定。本文編集（submit でも confirm でもない reportBody 送信）は未確定に戻す。
  if (body.confirmComment === true) update.commentConfirmedAt = new Date();
  else if (body.reportBody !== undefined && !submit) update.commentConfirmedAt = null;

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
      reportBody: body.reportBody ?? null,
      commentConfirmedAt: body.confirmComment === true ? new Date() : null,
      status: submit ? "SUBMITTED" : "DRAFT",
      submittedAt: submit ? new Date() : null,
    },
    update,
  });

  // 提出時のみ LINE WORKS 通知（fire&forget・本体をブロックしない）。下書き自動保存では送らない。
  if (submit) {
    const sched = await buildScheduleSummary(user.id, dateStr);
    const base = {
      caName: user.name,
      dateStr,
      userId: user.id, // T-085: 通知リンクに付けて提出者本人の日報を閲覧モードで開く
      plannedCount: sched.summary.plannedCount,
      completedCount: sched.summary.completedCount,
      reportBody: (body.reportBody ?? report.reportBody) ?? null,
    };

    if (formatHasNumbers(actor.format)) {
      const from = jstDateStart(dateStr);
      const to = jstDateEnd(dateStr);
      const [dayMatrix, jobSearch] = await Promise.all([
        computeWeeklyMatrix({ employeeId: actor.employeeId ?? "__nonexistent__", userId: user.id, from, to }),
        computeJobSearchDay(user.id, dateStr),
      ]);
      void notifyDailyReport({
        ...base,
        interviewTotal: dayMatrix.interview.total,
        interviewFirst: dayMatrix.interview.first,
        interviewExisting: dayMatrix.interview.second + dayMatrix.interview.thirdPlus,
        bmCount: jobSearch.bmCount,
        exportCount: jobSearch.exportCount,
        entryTotal: dayMatrix.entry.total.uniq,
        selectionRate: jobSearch.selectionRate,
        dCount: jobSearch.ratings["D"] ?? 0,
      }).catch((e) => console.warn("日報LINE通知 失敗:", e?.message ?? e));
    } else {
      void notifyDailyReport(base).catch((e) => console.warn("日報LINE通知 失敗:", e?.message ?? e));
    }
  }

  return NextResponse.json({ report });
}

// 開発用：JST 当日窓の sanity check に使う（4-4 の罠 #17 で誤った窓を切らないか確認）。
export const _internalJstWindow = (dateStr: string) => ({
  start: jstDateStart(dateStr).toISOString(),
  end: jstDateEnd(dateStr).toISOString(),
});
