// T-139 Task2: PATCH /api/external/schedule-tasks/[taskId]
// 日程調整AIエージェント（外部RPA機）がタスクの status 変更 / コメント追加を行う更新API。
// 安全柵: 対象がカテゴリ「日程調整」でなければ 403（一切更新しない）。存在しなければ 404。
// 通知抑止: 既存の内部ルート（status/comments）は LINE WORKS 通知を発火させるが、本APIは
//   notification ヘルパーを一切呼ばない＝夜間ポーリングでの通知連発を防ぐ。
import { NextResponse } from "next/server";
import type { TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AI_COMMENT_PREFIX,
  SCHEDULE_CATEGORY_NAME,
  VALID_TASK_STATUSES,
  isAuthorizedExternal,
  resolveSystemUserId,
  scheduleTaskInclude,
  serializeScheduleTask,
} from "@/lib/schedule-tasks";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  if (!isAuthorizedExternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;

  let body: { status?: unknown; comment?: unknown };
  try {
    body = (await request.json()) as { status?: unknown; comment?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // status / comment は両方任意だが、少なくとも一方は必須。
  const hasStatus = body.status !== undefined && body.status !== null;
  const hasComment = body.comment !== undefined && body.comment !== null;
  if (!hasStatus && !hasComment) {
    return NextResponse.json({ error: "status または comment のいずれかが必要です" }, { status: 400 });
  }

  // status 検証（許可値のみ）。
  let nextStatus: TaskStatus | null = null;
  if (hasStatus) {
    const s = String(body.status);
    if (!VALID_TASK_STATUSES.includes(s as (typeof VALID_TASK_STATUSES)[number])) {
      return NextResponse.json(
        { error: `無効なstatus: ${s}（許可値: ${VALID_TASK_STATUSES.join(", ")}）` },
        { status: 400 },
      );
    }
    nextStatus = s as TaskStatus;
  }

  // comment 検証。
  let commentContent: string | null = null;
  if (hasComment) {
    const c = typeof body.comment === "string" ? body.comment.trim() : "";
    if (!c) {
      return NextResponse.json({ error: "comment は空にできません" }, { status: 400 });
    }
    if (c.length > 2000) {
      return NextResponse.json({ error: "comment は2000文字以内で指定してください" }, { status: 400 });
    }
    commentContent = c;
  }

  // 対象タスク取得（存在確認＋カテゴリ柵）。
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, category: { select: { name: true } } },
  });
  if (!task) {
    return NextResponse.json({ error: "タスクが見つかりません" }, { status: 404 });
  }
  if (task.category?.name !== SCHEDULE_CATEGORY_NAME) {
    // 日程調整以外は一切触らない。
    return NextResponse.json({ error: "対象タスクは日程調整カテゴリではありません" }, { status: 403 });
  }

  // コメント作者（TaskComment.userId 必須）はシステムユーザー。本文に AI 接頭辞を付けて人間が判別可能に。
  if (commentContent) {
    const systemUserId = await resolveSystemUserId();
    if (!systemUserId) {
      return NextResponse.json({ error: "コメント作者のシステムユーザーが見つかりません" }, { status: 500 });
    }
    await prisma.taskComment.create({
      data: {
        taskId,
        userId: systemUserId,
        content: `${AI_COMMENT_PREFIX} ${commentContent}`,
      },
    });
  }

  // status 更新（通知ヘルパーは呼ばない＝発火なし）。
  if (nextStatus) {
    await prisma.task.update({ where: { id: taskId }, data: { status: nextStatus } });
  }

  // 更新後のタスクを GET と同じ形状で返す。
  const updated = await prisma.task.findUnique({
    where: { id: taskId },
    include: scheduleTaskInclude,
  });
  if (!updated) {
    return NextResponse.json({ error: "更新後のタスク取得に失敗しました" }, { status: 500 });
  }
  return NextResponse.json(serializeScheduleTask(updated));
}
