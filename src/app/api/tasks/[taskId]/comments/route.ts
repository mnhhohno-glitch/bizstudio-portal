import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

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

  // タスク存在確認
  const task = await prisma.task.findUnique({ where: { id: taskId } });
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

  return NextResponse.json({ comment }, { status: 201 });
}
