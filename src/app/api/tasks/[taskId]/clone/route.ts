import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

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
        notificationPending: true,
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
    });

    return NextResponse.json({ id: newTask.id }, { status: 201 });
  } catch (error) {
    console.error("タスク複製エラー:", error);
    return NextResponse.json({ error: "タスクの複製に失敗しました" }, { status: 500 });
  }
}
