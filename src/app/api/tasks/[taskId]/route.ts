import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { notifyTaskCreated } from "@/lib/task-notification";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { taskId } = await params;
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        category: { select: { id: true, name: true } },
        candidate: { select: { id: true, name: true, candidateNumber: true } },
        createdByUser: { select: { id: true, name: true } },
        assignees: {
          include: { employee: { select: { id: true, name: true, employeeNumber: true } } },
        },
        assigneeStatuses: {
          select: { userId: true, isCompleted: true, completedAt: true, user: { select: { id: true, name: true } } },
        },
        fieldValues: {
          include: {
            field: {
              select: {
                id: true,
                label: true,
                fieldType: true,
                sortOrder: true,
                options: { orderBy: { sortOrder: "asc" }, select: { id: true, label: true, value: true } },
              },
            },
          },
        },
        attachments: true,
        comments: {
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "タスクが見つかりません" }, { status: 404 });
    }

    return NextResponse.json({ task });
  } catch {
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { taskId } = await params;
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { createdByUserId: true, notificationPending: true, completionType: true },
    });

    if (!task) {
      return NextResponse.json({ error: "タスクが見つかりません" }, { status: 404 });
    }

    // 作成者 or admin のみ更新可能
    if (task.createdByUserId !== actor.id && actor.role !== "admin") {
      return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    }

    const isNotificationPending = task.notificationPending;

    const body = await request.json();
    const { title, description, status, priority, dueDate, assigneeIds, fieldValues } = body;

    // タスク本体を更新
    await prisma.task.update({
      where: { id: taskId },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(status !== undefined && { status }),
        ...(priority !== undefined && { priority }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
      },
    });

    // 担当者の更新
    if (assigneeIds !== undefined) {
      await prisma.taskAssignee.deleteMany({ where: { taskId } });
      if (assigneeIds.length > 0) {
        await prisma.taskAssignee.createMany({
          data: assigneeIds.map((employeeId: string) => ({ taskId, employeeId })),
        });
      }

      // completionType="all" の場合、TaskAssigneeStatus を再生成
      if (task.completionType === "all" && assigneeIds.length > 1) {
        await prisma.taskAssigneeStatus.deleteMany({ where: { taskId } });
        const assigneeEmployees = await prisma.employee.findMany({
          where: { id: { in: assigneeIds }, status: "active" },
          select: { name: true },
        });
        const assigneeUsers = assigneeEmployees.length > 0
          ? await prisma.user.findMany({
              where: { name: { in: assigneeEmployees.map((e: { name: string }) => e.name) }, status: "active" },
              select: { id: true },
            })
          : [];
        if (assigneeUsers.length > 0) {
          await prisma.taskAssigneeStatus.createMany({
            data: assigneeUsers.map((u: { id: string }) => ({ taskId, userId: u.id, isCompleted: false })),
            skipDuplicates: true,
          });
        }
      }
    }

    // フィールド値の更新
    if (fieldValues !== undefined) {
      await prisma.taskFieldValue.deleteMany({ where: { taskId } });
      if (fieldValues.length > 0) {
        await prisma.taskFieldValue.createMany({
          data: fieldValues.map((fv: { fieldId: string; value: string }) => ({
            taskId,
            fieldId: fv.fieldId,
            value: fv.value,
          })),
        });
      }
    }

    // 複製タスクの初回保存時に通知を送信
    if (isNotificationPending) {
      await prisma.task.update({
        where: { id: taskId },
        data: { notificationPending: false },
      });

      sendCloneNotification(taskId, actor).catch((e) =>
        console.error("複製タスク通知エラー:", e)
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update task:", error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { taskId } = await params;
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { createdByUserId: true },
    });

    if (!task) {
      return NextResponse.json({ error: "タスクが見つかりません" }, { status: 404 });
    }

    // 作成者 or admin のみ削除可能
    if (task.createdByUserId !== actor.id && actor.role !== "admin") {
      return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    }

    // 添付ファイルをSupabase Storageから削除
    const attachments = await prisma.taskAttachment.findMany({
      where: { taskId },
      select: { storagePath: true },
    });
    if (attachments.length > 0) {
      const paths = attachments.map((a) => a.storagePath);
      const { error: storageError } = await supabase.storage
        .from("task-attachments")
        .remove(paths);
      if (storageError) {
        console.error("Failed to delete attachments from storage:", storageError);
      }
    }

    await prisma.task.delete({ where: { id: taskId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete task:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}

async function sendCloneNotification(
  taskId: string,
  actor: { id: string; name: string }
) {
  const saved = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      category: { select: { name: true } },
      candidate: { select: { name: true } },
      assignees: { include: { employee: { select: { name: true } } } },
    },
  });
  if (!saved) return;

  const assigneeNames = saved.assignees.map((a) => a.employee.name);

  // 複製者自身のみが担当者の場合は通知不要
  const assigneeUsers =
    assigneeNames.length > 0
      ? await prisma.user.findMany({
          where: { name: { in: assigneeNames }, status: "active" },
          select: { id: true, name: true, lineworksId: true },
        })
      : [];

  // 複製者（作成者）以外の担当者がいなければ通知しない
  const otherAssignees = assigneeUsers.filter((u) => u.id !== actor.id);
  if (otherAssignees.length === 0) return;

  const assigneeLineworksIds = assigneeNames.map((name) => {
    const user = assigneeUsers.find((u) => u.name === name);
    // 複製者自身のlineworksIdは除外（自分には通知しない）
    if (user && user.id === actor.id) return null;
    return user?.lineworksId ?? null;
  });

  await notifyTaskCreated({
    taskId: saved.id,
    title: saved.title,
    categoryName: saved.category?.name ?? null,
    candidateName: saved.candidate?.name ?? null,
    assigneeNames,
    assigneeLineworksIds,
    priority: saved.priority ?? null,
    dueDate: saved.dueDate,
    creatorName: actor.name,
  });
}
