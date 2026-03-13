import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function POST(request: Request) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const {
      title,
      description,
      categoryId,
      candidateId,
      status,
      priority,
      dueDate,
      assigneeIds,
      fieldValues,
    } = body;

    if (!title?.trim()) {
      return NextResponse.json({ error: "タイトルは必須です" }, { status: 400 });
    }
    if (!assigneeIds || assigneeIds.length === 0) {
      return NextResponse.json({ error: "担当者は最低1名必要です" }, { status: 400 });
    }

    const task = await prisma.task.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        categoryId: categoryId || null,
        candidateId: candidateId || null,
        status: status || "NOT_STARTED",
        priority: priority || "MEDIUM",
        dueDate: dueDate ? new Date(dueDate) : null,
        createdByUserId: actor.id,
        assignees: {
          create: assigneeIds.map((employeeId: string) => ({ employeeId })),
        },
        fieldValues: {
          create: (fieldValues || []).map(
            (fv: { fieldId: string; value: string }) => ({
              fieldId: fv.fieldId,
              value: fv.value,
            })
          ),
        },
      },
    });

    return NextResponse.json({ id: task.id }, { status: 201 });
  } catch (error) {
    console.error("Failed to create task:", error);
    return NextResponse.json({ error: "タスク作成に失敗しました" }, { status: 500 });
  }
}
