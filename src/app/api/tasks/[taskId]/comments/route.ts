import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { notifyTaskComment } from "@/lib/task-notification";

// GET /api/tasks/[taskId]/comments — コメント一覧取得
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;

  const comments = await prisma.taskComment.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ comments });
}

// POST /api/tasks/[taskId]/comments — コメント投稿
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;

  const body = await req.json();
  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!content) {
    return NextResponse.json({ error: "コメント内容を入力してください" }, { status: 400 });
  }
  if (content.length > 2000) {
    return NextResponse.json({ error: "コメントは2000文字以内で入力してください" }, { status: 400 });
  }

  // タスク存在確認（通知用に関連情報も取得）
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      category: { select: { name: true } },
      candidate: { select: { name: true } },
      createdByUser: { select: { id: true, name: true, lineworksId: true } },
      assignees: { include: { employee: { select: { name: true } } } },
    },
  });
  if (!task) {
    return NextResponse.json({ error: "タスクが見つかりません" }, { status: 404 });
  }

  const comment = await prisma.taskComment.create({
    data: {
      taskId,
      userId: actor.id,
      content,
    },
    include: {
      user: { select: { id: true, name: true } },
    },
  });

  // LINE WORKS通知（非同期）
  sendCommentNotification(task, comment, actor).catch((e) =>
    console.error("コメント通知エラー:", e)
  );

  return NextResponse.json({ comment }, { status: 201 });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendCommentNotification(task: any, comment: any, actor: { id: string; name: string }) {
  // 担当者名からUserのlineworksIdを取得
  const assigneeNames: string[] = task.assignees.map((a: { employee: { name: string } }) => a.employee.name);
  const assigneeUsers =
    assigneeNames.length > 0
      ? await prisma.user.findMany({
          where: { name: { in: assigneeNames }, status: "active" },
          select: { id: true, name: true, lineworksId: true },
        })
      : [];

  // 通知対象: 担当者 + 作成者（投稿者自身は除外）
  const recipientMap = new Map<string, { name: string; lineworksId: string | null }>();

  // 担当者を追加
  for (const user of assigneeUsers) {
    if (user.id !== actor.id) {
      recipientMap.set(user.id, { name: user.name, lineworksId: user.lineworksId });
    }
  }

  // 作成者を追加
  if (task.createdByUser && task.createdByUser.id !== actor.id) {
    recipientMap.set(task.createdByUser.id, {
      name: task.createdByUser.name,
      lineworksId: task.createdByUser.lineworksId,
    });
  }

  if (recipientMap.size === 0) return;

  const recipients = Array.from(recipientMap.values());

  await notifyTaskComment({
    taskId: task.id,
    title: task.title,
    categoryName: task.category?.name ?? null,
    candidateName: task.candidate?.name ?? null,
    commentContent: comment.content,
    commentedAt: comment.createdAt,
    commenterName: actor.name,
    commenterId: actor.id,
    recipientLineworksIds: recipients.map((r) => r.lineworksId),
    recipientNames: recipients.map((r) => r.name),
  });
}
