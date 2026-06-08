// T-085: 日報コメント CRUD。
// - 閲覧者（ログイン済み）なら誰でもコメント投稿・閲覧可。
// - 削除は投稿者本人または admin のみ。
// - 対象 DailyReport が無い場合は空の DRAFT を作って紐付ける（未提出の日でもコメント可）。
// - DailyReportChat（AIチャット履歴）とは別物。混同しない。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { jstDateStringToDbDate, todayJstDateString } from "@/lib/dailyReport/jstDate";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// 対象ユーザー×日付の DailyReport を取得（無ければ空 DRAFT を作成）し id を返す。
async function ensureReportId(targetUserId: string, dateStr: string): Promise<string> {
  const dbDate = jstDateStringToDbDate(dateStr);
  const report = await prisma.dailyReport.upsert({
    where: { userId_date: { userId: targetUserId, date: dbDate } },
    create: { userId: targetUserId, date: dbDate, status: "DRAFT" },
    update: {},
    select: { id: true },
  });
  return report.id;
}

async function listComments(dailyReportId: string) {
  const rows = await prisma.dailyReportComment.findMany({
    where: { dailyReportId },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true } } },
  });
  return rows.map((c) => ({
    id: c.id,
    body: c.body,
    userId: c.userId,
    userName: c.user?.name ?? "",
    createdAt: c.createdAt,
  }));
}

// GET ?dailyReportId= もしくは ?userId=&date=  → コメント一覧（昇順・投稿者名つき）。
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const dailyReportId = searchParams.get("dailyReportId");
  const targetUserId = searchParams.get("userId");
  const dateStr = searchParams.get("date") ?? todayJstDateString();

  let reportId = dailyReportId ?? null;
  if (!reportId && targetUserId) {
    const dbDate = jstDateStringToDbDate(dateStr);
    const report = await prisma.dailyReport.findUnique({
      where: { userId_date: { userId: targetUserId, date: dbDate } },
      select: { id: true },
    });
    if (!report) return NextResponse.json({ comments: [] }); // 日報未作成 → コメントなし
    reportId = report.id;
  }
  if (!reportId) return NextResponse.json({ error: "dailyReportId または userId が必要です" }, { status: 400 });

  return NextResponse.json({ comments: await listComments(reportId) });
}

// POST { dailyReportId, body } もしくは { userId, date, body } → コメント作成（誰でも可）。
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const payload = (await req.json().catch(() => null)) as {
    dailyReportId?: string;
    userId?: string; // 対象ユーザー（日報の所有者）
    date?: string;
    body?: string;
  } | null;
  if (!payload) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const text = (payload.body ?? "").trim();
  if (!text) return NextResponse.json({ error: "コメント本文が空です" }, { status: 400 });

  let reportId = payload.dailyReportId ?? null;
  if (!reportId) {
    if (!payload.userId) return NextResponse.json({ error: "dailyReportId または userId が必要です" }, { status: 400 });
    const dateStr = payload.date && YMD.test(payload.date) ? payload.date : todayJstDateString();
    reportId = await ensureReportId(payload.userId, dateStr);
  }

  const created = await prisma.dailyReportComment.create({
    data: { dailyReportId: reportId, userId: user.id, body: text },
    include: { user: { select: { id: true, name: true } } },
  });

  return NextResponse.json({
    comment: {
      id: created.id,
      body: created.body,
      userId: created.userId,
      userName: created.user?.name ?? "",
      createdAt: created.createdAt,
    },
    comments: await listComments(reportId),
  });
}

// DELETE ?id= → 投稿者本人 または admin のみ。
export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id が必要です" }, { status: 400 });

  const comment = await prisma.dailyReportComment.findUnique({ where: { id }, select: { id: true, userId: true, dailyReportId: true } });
  if (!comment) return NextResponse.json({ error: "コメントが見つかりません" }, { status: 404 });

  if (comment.userId !== user.id && user.role !== "admin") {
    return NextResponse.json({ error: "削除できるのは投稿者本人または管理者のみです" }, { status: 403 });
  }

  await prisma.dailyReportComment.delete({ where: { id } });
  return NextResponse.json({ ok: true, comments: await listComments(comment.dailyReportId) });
}
