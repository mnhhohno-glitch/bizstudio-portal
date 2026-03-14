import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type Params = { params: Promise<{ taskId: string; commentId: string }> };

// PUT /api/tasks/[taskId]/comments/[commentId] — コメント編集
export async function PUT(req: NextRequest, { params }: Params) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { commentId } = await params;

  const existing = await prisma.taskComment.findUnique({
    where: { id: commentId },
  });
  if (!existing) {
    return NextResponse.json({ error: "コメントが見つかりません" }, { status: 404 });
  }

  // 投稿者本人のみ編集可能
  if (existing.userId !== actor.id) {
    return NextResponse.json({ error: "このコメントを編集する権限がありません" }, { status: 403 });
  }

  const body = await req.json();
  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!content) {
    return NextResponse.json({ error: "コメント内容を入力してください" }, { status: 400 });
  }
  if (content.length > 2000) {
    return NextResponse.json({ error: "コメントは2000文字以内で入力してください" }, { status: 400 });
  }

  const comment = await prisma.taskComment.update({
    where: { id: commentId },
    data: { content },
    include: {
      user: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ comment });
}

// DELETE /api/tasks/[taskId]/comments/[commentId] — コメント削除
export async function DELETE(_req: NextRequest, { params }: Params) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { commentId } = await params;

  const existing = await prisma.taskComment.findUnique({
    where: { id: commentId },
  });
  if (!existing) {
    return NextResponse.json({ error: "コメントが見つかりません" }, { status: 404 });
  }

  // 投稿者本人 or admin のみ削除可能
  if (existing.userId !== actor.id && actor.role !== "admin") {
    return NextResponse.json({ error: "このコメントを削除する権限がありません" }, { status: 403 });
  }

  await prisma.taskComment.delete({ where: { id: commentId } });

  return NextResponse.json({ success: true });
}
