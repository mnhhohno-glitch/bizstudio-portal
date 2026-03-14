import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { notifyTaskCreated } from "@/lib/task-notification";

export async function GET(request: Request) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const categoryId = searchParams.get("categoryId");
    const priority = searchParams.get("priority");
    const candidateName = searchParams.get("candidateName");
    const assigneeId = searchParams.get("assigneeId");
    const showAll = searchParams.get("showAll") === "true";
    const includeCompleted = searchParams.get("includeCompleted") === "true";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
    const perPage = 20;

    const where: Prisma.TaskWhereInput = {};

    // フィルター: 担当者ベース（非admin or showAll=false）
    if (actor.role !== "admin" || !showAll) {
      // ログインユーザー名で社員を検索
      const employee = await prisma.employee.findFirst({
        where: { name: actor.name, status: "active" },
      });
      if (employee) {
        where.assignees = { some: { employeeId: employee.id } };
      }
      // 一致する社員がない場合は全タスク表示（仕様通り）
    }

    // 完了タスクの表示制御
    if (!includeCompleted && !status) {
      where.status = { not: "COMPLETED" };
    }
    if (status) where.status = status as Prisma.EnumTaskStatusFilter;
    if (categoryId) {
      if (categoryId.includes(",")) {
        where.categoryId = { in: categoryId.split(",") };
      } else {
        where.categoryId = categoryId;
      }
    }
    if (priority) where.priority = priority as Prisma.EnumTaskPriorityNullableFilter;
    if (candidateName) {
      where.candidate = { name: { contains: candidateName, mode: "insensitive" } };
    }
    if (assigneeId) {
      where.assignees = {
        ...where.assignees as Prisma.TaskAssigneeListRelationFilter,
        some: { ...(where.assignees as { some?: object })?.some, employeeId: assigneeId },
      };
    }

    // ソート
    const validSortFields = ["createdAt", "dueDate", "title", "status", "priority"];
    const orderField = validSortFields.includes(sortBy) ? sortBy : "createdAt";
    const orderBy: Prisma.TaskOrderByWithRelationInput = { [orderField]: sortOrder };

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          category: { select: { id: true, name: true } },
          candidate: { select: { name: true } },
          createdByUser: { select: { name: true } },
          assignees: {
            include: { employee: { select: { name: true } } },
          },
        },
      }),
      prisma.task.count({ where }),
    ]);

    return NextResponse.json({
      tasks,
      total,
      page,
      totalPages: Math.ceil(total / perPage),
    });
  } catch (error) {
    console.error("Failed to fetch tasks:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

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
      include: {
        category: { select: { name: true } },
        candidate: { select: { name: true } },
        assignees: { include: { employee: { select: { name: true } } } },
      },
    });

    // LINE WORKS通知（失敗してもタスク作成には影響させない）
    try {
      // 担当者名からUserのlineworksIdを取得（メンション用）
      const assigneeNames = task.assignees.map((a) => a.employee.name);
      const assigneeUsers = assigneeNames.length > 0
        ? await prisma.user.findMany({
            where: { name: { in: assigneeNames }, status: "active" },
            select: { name: true, lineworksId: true },
          })
        : [];

      // 担当者名の順序に合わせてlineworksIdを対応付け
      const assigneeLineworksIds = assigneeNames.map((name) => {
        const user = assigneeUsers.find((u) => u.name === name);
        return user?.lineworksId ?? null;
      });

      await notifyTaskCreated({
        taskId: task.id,
        title: task.title,
        categoryName: task.category?.name ?? null,
        candidateName: task.candidate?.name ?? null,
        assigneeNames,
        assigneeLineworksIds,
        priority: priority || null,
        dueDate: task.dueDate,
        creatorName: actor.name,
      });
    } catch (notifyError) {
      console.error("LINE WORKS通知の送信に失敗:", notifyError);
    }

    return NextResponse.json({ id: task.id }, { status: 201 });
  } catch (error) {
    console.error("Failed to create task:", error);
    return NextResponse.json({ error: "タスク作成に失敗しました" }, { status: 500 });
  }
}
