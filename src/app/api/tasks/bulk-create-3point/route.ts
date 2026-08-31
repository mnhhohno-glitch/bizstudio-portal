import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { sendBotMessage } from "@/lib/lineworks";
import {
  resolveAssigneeNotifyTargets,
  logAssigneeNotifyTargets,
  type AssigneeNotifyTarget,
} from "@/lib/task-notification";
import { TaskPriority } from "@prisma/client";

const CATEGORY_IDS = {
  rirekisho: "cmmolxn1v0026po4f0olekfps",
  shokumukeirekisho: "cmmolxv0g002qpo4fazblhj0f",
  suisenjou: "cmmolxxtl002xpo4f1mf6srei",
} as const;

const CATEGORY_NAMES = ["履歴書作成", "職務経歴書作成", "推薦状作成"];

export async function POST(request: Request) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { candidateId, assigneeId, assigneeIds, completionType, dueDate, priority, fieldValues } =
      body as {
        candidateId: string;
        /** T-162 以前の単数フィールド。旧クライアント互換のため残す。 */
        assigneeId?: string;
        assigneeIds?: string[];
        completionType?: string;
        dueDate?: string;
        priority?: string;
        fieldValues?: {
          resume?: { fieldId: string; value: string }[];
          career?: { fieldId: string; value: string }[];
          recommendation?: { fieldId: string; value: string }[];
        };
      };

    // T-162: 複数担当者に対応。単数 assigneeId は旧クライアント互換のフォールバック。
    const requestedAssigneeIds = Array.from(
      new Set(
        (Array.isArray(assigneeIds) && assigneeIds.length > 0
          ? assigneeIds
          : assigneeId
            ? [assigneeId]
            : []
        ).filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    );

    if (!candidateId || requestedAssigneeIds.length === 0) {
      return NextResponse.json(
        { error: "求職者と担当者は必須です" },
        { status: 400 }
      );
    }

    const [candidate, employees] = await Promise.all([
      prisma.candidate.findUnique({
        where: { id: candidateId },
        select: { id: true, name: true, candidateNumber: true },
      }),
      prisma.employee.findMany({
        where: { id: { in: requestedAssigneeIds } },
        select: { id: true, name: true },
      }),
    ]);

    if (!candidate) {
      return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
    }
    if (employees.length !== requestedAssigneeIds.length) {
      return NextResponse.json({ error: "担当者が見つかりません" }, { status: 404 });
    }

    // 画面で選んだ順序を保つ（通知本文の担当者順を選択順に合わせる）
    const orderedEmployeeIds = requestedAssigneeIds;

    const categories = await prisma.taskCategory.findMany({
      where: { id: { in: Object.values(CATEGORY_IDS) } },
      select: { id: true, name: true },
    });

    if (categories.length !== 3) {
      return NextResponse.json(
        { error: "タスクカテゴリの設定が不正です" },
        { status: 500 }
      );
    }

    const resolvedCompletionType =
      orderedEmployeeIds.length > 1 && completionType === "all" ? "all" : "any";

    const fvKeys = ["resume", "career", "recommendation"] as const;
    const createdTasks = await prisma.$transaction(
      Object.values(CATEGORY_IDS).map((categoryId, idx) => {
        const cat = categories.find((c) => c.id === categoryId);
        const fvs = fieldValues?.[fvKeys[idx]] ?? [];
        return prisma.task.create({
          data: {
            title: `${cat?.name ?? "書類作成"} - ${candidate.name}`,
            categoryId,
            candidateId: candidate.id,
            status: "NOT_STARTED",
            priority: (priority || "MEDIUM") as TaskPriority,
            dueDate: dueDate ? new Date(dueDate) : null,
            createdByUserId: actor.id,
            completionType: resolvedCompletionType,
            assignees: {
              create: orderedEmployeeIds.map((employeeId) => ({ employeeId })),
            },
            ...(fvs.length > 0 ? {
              fieldValues: {
                create: fvs.map((fv: { fieldId: string; value: string }) => ({
                  fieldId: fv.fieldId,
                  value: fv.value,
                })),
              },
            } : {}),
          },
        });
      })
    );

    // T-162: 担当者 → User の解決は Employee.userId 経由の共通ヘルパーに統一。
    const notifyTargets = await resolveAssigneeNotifyTargets(orderedEmployeeIds);

    // completionType="all" の場合、全担当者分の TaskAssigneeStatus を生成（/api/tasks と同じ扱い）
    if (resolvedCompletionType === "all") {
      const userIds = Array.from(
        new Set(notifyTargets.map((t) => t.userId).filter((id): id is string => !!id)),
      );
      if (userIds.length > 0) {
        await prisma.taskAssigneeStatus.createMany({
          data: createdTasks.flatMap((t) =>
            userIds.map((userId) => ({ taskId: t.id, userId, isCompleted: false })),
          ),
          skipDuplicates: true,
        });
      }
    }

    sendBulkNotification({
      candidateName: candidate.name,
      candidateNumber: candidate.candidateNumber,
      notifyTargets,
      creatorName: actor.name,
      taskIds: createdTasks.map((t) => t.id),
      priority: priority || null,
      dueDate: dueDate ? new Date(dueDate) : null,
    }).catch((e) => console.error("3点セット通知エラー:", e));

    return NextResponse.json({
      success: true,
      createdTaskIds: createdTasks.map((t) => t.id),
      message: "履歴書作成・職務経歴書作成・推薦状作成のタスクを一括起票しました",
    });
  } catch (error) {
    console.error("Failed to bulk create 3-point tasks:", error);
    return NextResponse.json(
      { error: "一括起票に失敗しました" },
      { status: 500 }
    );
  }
}

async function sendBulkNotification(params: {
  candidateName: string;
  candidateNumber: string;
  notifyTargets: AssigneeNotifyTarget[];
  creatorName: string;
  taskIds: string[];
  priority: string | null;
  dueDate: Date | null;
}) {
  const botId = process.env.LINEWORKS_TASK_BOT_ID;
  const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
  const baseUrl = process.env.PORTAL_BASE_URL;

  logAssigneeNotifyTargets(
    "task-notify:3point",
    params.taskIds.join("+"),
    params.notifyTargets,
  );

  if (!botId || !channelId) {
    console.warn("LINE WORKS タスク通知の環境変数が未設定です");
    return;
  }

  const dueDateStr = params.dueDate
    ? new Date(params.dueDate).toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    : "未設定";

  const PRIORITY_LABEL: Record<string, string> = {
    HIGH: "高",
    MEDIUM: "中",
    LOW: "低",
  };

  const taskLinks = params.taskIds
    .map((id, i) => `  • ${CATEGORY_NAMES[i]}: ${baseUrl}/tasks/${id}`)
    .join("\n");

  const assigneeNames = params.notifyTargets.map((t) => t.name);
  const mentionIds = params.notifyTargets
    .map((t) => t.lineworksId)
    .filter((id): id is string => !!id);

  const lines = [
    "📋 応募書類3点セットのタスクが作成されました",
    "",
    "■ 求職者",
    `${params.candidateName}（${params.candidateNumber}）`,
    "",
    "■ 作成されたタスク",
    taskLinks,
    "",
    "■ 担当者",
    assigneeNames.join("、") || "未設定",
    "",
    "■ 優先度",
    params.priority ? (PRIORITY_LABEL[params.priority] ?? params.priority) : "未設定",
    "",
    "■ 期限",
    dueDateStr,
    "",
    "■ 作成者",
    params.creatorName,
  ];

  const assignHeader = `${params.creatorName}から応募書類3点セットのタスクが割り当てられました`;

  if (mentionIds.length > 0) {
    const mentionedLines = [
      ...mentionIds.map((id) => `<m userId="${id}">`),
      ` ${assignHeader}`,
      "",
      ...lines.slice(2),
    ];
    try {
      await sendBotMessage(botId, channelId, mentionedLines.join("\n"));
      console.log(
        `[task-notify:3point] sent mentions=${mentionIds.length} tasks=${params.taskIds.length}`,
      );
      return;
    } catch (e) {
      console.warn("メンション付き3点セット通知に失敗:", e);
    }
  }

  const namePrefix = assigneeNames.map((n) => `${n}さん`).join("、");
  const fallbackLines = [
    `${namePrefix} ${assignHeader}`,
    "",
    ...lines.slice(2),
  ];
  await sendBotMessage(botId, channelId, fallbackLines.join("\n"));
  console.log(
    `[task-notify:3point] sent fallback(no-mention) recipients=${assigneeNames.length} tasks=${params.taskIds.length}`,
  );
}
