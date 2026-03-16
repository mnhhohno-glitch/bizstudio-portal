import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { notifyTaskCreated } from "@/lib/task-notification";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { taskId } = await params;

    const original = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignees: { select: { employeeId: true } },
        fieldValues: { select: { fieldId: true, value: true } },
      },
    });

    if (!original) {
      return NextResponse.json({ error: "タスクが見つかりません" }, { status: 404 });
    }

    const newTask = await prisma.task.create({
      data: {
        title: `【複製】${original.title}`,
        description: original.description,
        categoryId: original.categoryId,
        candidateId: original.candidateId,
        status: "NOT_STARTED",
        priority: original.priority,
        dueDate: original.dueDate,
        completionType: original.completionType,
        createdByUserId: actor.id,
        assignees: {
          create: original.assignees.map((a) => ({ employeeId: a.employeeId })),
        },
        fieldValues: {
          create: original.fieldValues.map((fv) => ({
            fieldId: fv.fieldId,
            value: fv.value,
          })),
        },
      },
      include: {
        category: { select: { name: true } },
        candidate: { select: { name: true } },
        assignees: { include: { employee: { select: { name: true } } } },
      },
    });

    // LINE WORKS通知（非同期）
    try {
      const assigneeNames = newTask.assignees.map((a) => a.employee.name);
      const assigneeUsers = assigneeNames.length > 0
        ? await prisma.user.findMany({
            where: { name: { in: assigneeNames }, status: "active" },
            select: { name: true, lineworksId: true },
          })
        : [];
      const assigneeLineworksIds = assigneeNames.map((name) => {
        const user = assigneeUsers.find((u) => u.name === name);
        return user?.lineworksId ?? null;
      });

      notifyTaskCreated({
        taskId: newTask.id,
        title: newTask.title,
        categoryName: newTask.category?.name ?? null,
        candidateName: newTask.candidate?.name ?? null,
        assigneeNames,
        assigneeLineworksIds,
        priority: original.priority ?? null,
        dueDate: newTask.dueDate,
        creatorName: actor.name,
      }).catch((e) => console.error("LINE WORKS通知エラー:", e));
    } catch (notifyError) {
      console.error("LINE WORKS通知の送信に失敗:", notifyError);
    }

    return NextResponse.json({ id: newTask.id }, { status: 201 });
  } catch (error) {
    console.error("タスク複製エラー:", error);
    return NextResponse.json({ error: "タスクの複製に失敗しました" }, { status: 500 });
  }
}
