import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

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
      select: { createdByUserId: true },
    });

    if (!task) {
      return NextResponse.json({ error: "タスクが見つかりません" }, { status: 404 });
    }

    // 作成者 or admin のみ更新可能
    if (task.createdByUserId !== actor.id && actor.role !== "admin") {
      return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    }

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
