import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { sendBotMessage } from "@/lib/lineworks";

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
    const { candidateId, assigneeId, dueDate, priority } = body;

    if (!candidateId || !assigneeId) {
      return NextResponse.json(
        { error: "求職者と担当者は必須です" },
        { status: 400 }
      );
    }

    const [candidate, employee] = await Promise.all([
      prisma.candidate.findUnique({
        where: { id: candidateId },
        select: { id: true, name: true, candidateNumber: true },
      }),
      prisma.employee.findUnique({
        where: { id: assigneeId },
        select: { id: true, name: true },
      }),
    ]);

    if (!candidate) {
      return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
    }
    if (!employee) {
      return NextResponse.json({ error: "担当者が見つかりません" }, { status: 404 });
    }

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

    const createdTasks = await prisma.$transaction(
      Object.values(CATEGORY_IDS).map((categoryId) => {
        const cat = categories.find((c) => c.id === categoryId);
        return prisma.task.create({
          data: {
            title: `${cat?.name ?? "書類作成"} - ${candidate.name}`,
            categoryId,
            candidateId: candidate.id,
            status: "NOT_STARTED",
            priority: priority || "MEDIUM",
            dueDate: dueDate ? new Date(dueDate) : null,
            createdByUserId: actor.id,
            assignees: {
              create: [{ employeeId: assigneeId }],
            },
          },
        });
      })
    );

    sendBulkNotification({
      candidateName: candidate.name,
      candidateNumber: candidate.candidateNumber,
      assigneeName: employee.name,
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
  assigneeName: string;
  creatorName: string;
  taskIds: string[];
  priority: string | null;
  dueDate: Date | null;
}) {
  const botId = process.env.LINEWORKS_TASK_BOT_ID;
  const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
  const baseUrl = process.env.PORTAL_BASE_URL;

  if (!botId || !channelId) return;

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

  const assigneeUser = await prisma.user.findFirst({
    where: { name: params.assigneeName, status: "active" },
    select: { lineworksId: true },
  });

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
    params.assigneeName,
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

  if (assigneeUser?.lineworksId) {
    const mentionedLines = [
      `<m userId="${assigneeUser.lineworksId}">`,
      ` ${assignHeader}`,
      "",
      ...lines.slice(2),
    ];
    try {
      await sendBotMessage(botId, channelId, mentionedLines.join("\n"));
      return;
    } catch (e) {
      console.warn("メンション付き3点セット通知に失敗:", e);
    }
  }

  const fallbackLines = [
    `${params.assigneeName}さん ${assignHeader}`,
    "",
    ...lines.slice(2),
  ];
  await sendBotMessage(botId, channelId, fallbackLines.join("\n"));
}
