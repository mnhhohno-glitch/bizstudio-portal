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
      include: { assignees: { select: { employeeId: true } } },
    });

    if (!task) {
      return NextResponse.json({ error: "タスクが見つかりません" }, { status: 404 });
    }

    // 担当者 or 作成者 or admin のみ変更可能
    const isCreator = task.createdByUserId === actor.id;
    const isAdmin = actor.role === "admin";

    // ログインユーザー名で社員を検索して担当者判定
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

    await prisma.task.update({
      where: { id: taskId },
      data: { status },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update status:", error);
    return NextResponse.json({ error: "ステータス更新に失敗しました" }, { status: 500 });
  }
}
