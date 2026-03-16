import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function PATCH(
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
      include: {
        assignees: { select: { employeeId: true } },
        assigneeStatuses: true,
      },
    });

    if (!task) {
      return NextResponse.json({ error: "タスクが見つかりません" }, { status: 404 });
    }

    const isCreator = task.createdByUserId === actor.id;
    const isAdmin = actor.role === "admin";
    const employee = await prisma.employee.findFirst({
      where: { name: actor.name, status: "active" },
    });
    const isAssignee = employee
      ? task.assignees.some((a) => a.employeeId === employee.id)
      : false;

    if (!isCreator && !isAdmin && !isAssignee) {
      return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    }

    const body = await request.json();
    const { status } = body;

    const validStatuses = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: "無効なステータスです" }, { status: 400 });
    }

    // 「全員完了で完了」タイプの場合の特別処理
    if (status === "COMPLETED" && task.completionType === "all" && task.assignees.length > 1) {
      // 自分の完了状態を更新
      await prisma.taskAssigneeStatus.upsert({
        where: { taskId_userId: { taskId, userId: actor.id } },
        create: { taskId, userId: actor.id, isCompleted: true, completedAt: new Date() },
        update: { isCompleted: true, completedAt: new Date() },
      });

      // 全担当者の完了状態をチェック
      const allStatuses = await prisma.taskAssigneeStatus.findMany({
        where: { taskId },
      });
      const completedCount = allStatuses.filter((s) => s.isCompleted).length;
      const totalAssignees = task.assignees.length;

      if (completedCount >= totalAssignees) {
        // 全員完了 → タスク全体を完了
        await prisma.task.update({ where: { id: taskId }, data: { status: "COMPLETED" } });
      } else {
        // 一部完了 → 対応中に設定（未着手から変更）
        if (task.status === "NOT_STARTED") {
          await prisma.task.update({ where: { id: taskId }, data: { status: "IN_PROGRESS" } });
        }
      }

      return NextResponse.json({
        success: true,
        completedCount,
        totalAssignees,
        taskCompleted: completedCount >= totalAssignees,
      });
    }

    // 通常の完了処理（any or 単一担当者）
    await prisma.task.update({ where: { id: taskId }, data: { status } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update status:", error);
    return NextResponse.json({ error: "ステータス更新に失敗しました" }, { status: 500 });
  }
}
