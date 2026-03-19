import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendBotMessage } from "@/lib/lineworks";

interface CreateScheduleTaskRequest {
  type: "mynavi_new" | "consultation" | "interview";
  candidateName: string;
  preferredDates: string;
  meetingFormat: string;
  email?: string;
  notes?: string;
  advisorName?: string;
  candidateId?: string;
}

export async function POST(request: Request) {
  // 1. 認証チェック
  const apiSecret = request.headers.get("x-api-secret");
  const expectedSecret = process.env.EXTERNAL_API_SECRET;

  if (!expectedSecret || apiSecret !== expectedSecret) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const body: CreateScheduleTaskRequest = await request.json();
    const {
      type,
      candidateName,
      preferredDates,
      meetingFormat,
      notes,
      advisorName,
      candidateId,
    } = body;

    if (!candidateName || !preferredDates || !meetingFormat) {
      return NextResponse.json(
        { success: false, error: "candidateName, preferredDates, meetingFormat は必須です" },
        { status: 400 }
      );
    }

    // 2. タスクタイトル生成
    let taskTitle: string;
    switch (type) {
      case "mynavi_new":
        taskTitle = `【新規面談調整】新規応募者 ${candidateName}`;
        break;
      case "consultation":
        taskTitle = `【面談調整】${candidateName} - 担当:${advisorName ?? "未設定"}`;
        break;
      case "interview":
        taskTitle = `【面接希望日】${candidateName} - 担当:${advisorName ?? "未設定"}`;
        break;
      default:
        return NextResponse.json(
          { success: false, error: "無効なtypeです" },
          { status: 400 }
        );
    }

    // 3. 担当者決定
    let assigneeUserId: string | null = null;
    let assigneeEmployeeId: string | null = null;

    if (type !== "mynavi_new" && advisorName) {
      // advisorName から User を検索
      const advisorUser = await prisma.user.findFirst({
        where: { name: advisorName, status: "active" },
        include: { employee: { select: { id: true } } },
      });
      if (advisorUser) {
        assigneeUserId = advisorUser.id;
        assigneeEmployeeId = advisorUser.employee?.id ?? null;
      }
    }

    // フォールバック: デフォルト担当者
    if (!assigneeUserId) {
      const defaultSetting = await prisma.systemSetting.findUnique({
        where: { key: "default_mynavi_assignee_id" },
      });
      if (defaultSetting?.value) {
        assigneeUserId = defaultSetting.value;
        const defaultUser = await prisma.user.findUnique({
          where: { id: defaultSetting.value },
          include: { employee: { select: { id: true } } },
        });
        assigneeEmployeeId = defaultUser?.employee?.id ?? null;
      }
    }

    if (!assigneeEmployeeId) {
      return NextResponse.json(
        {
          success: false,
          error: "担当者を特定できません。管理者設定でデフォルト担当者を設定してください",
        },
        { status: 400 }
      );
    }

    // 4. 「日程調整」カテゴリ取得
    const category = await prisma.taskCategory.findFirst({
      where: { name: "日程調整" },
      include: {
        fields: { orderBy: { sortOrder: "asc" } },
      },
    });

    if (!category) {
      return NextResponse.json(
        { success: false, error: "「日程調整」カテゴリが見つかりません。シードを実行してください" },
        { status: 500 }
      );
    }

    // 5. フィールドマッピング
    const fieldMap: Record<string, string> = {
      "希望日時": preferredDates,
      "面談形式": meetingFormat,
    };
    if (notes) {
      fieldMap["備考"] = notes;
    }

    const fieldValuesData = category.fields
      .filter((f) => fieldMap[f.label] !== undefined)
      .map((f) => ({
        fieldId: f.id,
        value: fieldMap[f.label],
      }));

    // 6. createdByUserId の決定（担当者 or システムユーザー）
    const createdByUserId = assigneeUserId!;

    // 7. Task作成
    const task = await prisma.task.create({
      data: {
        title: taskTitle,
        status: "NOT_STARTED",
        categoryId: category.id,
        candidateId: candidateId || null,
        createdByUserId,
        completionType: "any",
        assignees: {
          create: [{ employeeId: assigneeEmployeeId }],
        },
        fieldValues: {
          create: fieldValuesData,
        },
      },
      include: {
        assignees: {
          include: { employee: { select: { name: true } } },
        },
      },
    });

    // 8. LINE WORKS通知
    try {
      const botId = process.env.LINEWORKS_TASK_BOT_ID;
      const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
      const baseUrl = process.env.PORTAL_BASE_URL;

      if (botId && channelId) {
        const assigneeName = task.assignees[0]?.employee.name ?? "未設定";

        const lines = [
          "📋 タスクが自動生成されました",
          "",
          `■ タイトル`,
          taskTitle,
          "",
          `■ カテゴリ`,
          "日程調整",
          "",
          `■ 担当者`,
          assigneeName,
          "",
          `■ ステータス`,
          "未着手",
          "",
          `■ 希望日時`,
          preferredDates,
          "",
          `■ 面談形式`,
          meetingFormat,
        ];

        if (notes) {
          lines.push("", `■ 備考`, notes);
        }

        lines.push("", "🔗 タスク詳細", `${baseUrl}/tasks/${task.id}`);

        // メンション付き通知を試行
        const assigneeUser = await prisma.user.findFirst({
          where: { name: task.assignees[0]?.employee.name, status: "active" },
          select: { lineworksId: true },
        });

        if (assigneeUser?.lineworksId) {
          const mentionedLines = [
            `<m userId="${assigneeUser.lineworksId}">`,
            " タスクが自動生成されました",
            "",
            ...lines.slice(2),
          ];
          try {
            await sendBotMessage(botId, channelId, mentionedLines.join("\n"));
          } catch {
            // メンション失敗時はメンションなしで送信
            await sendBotMessage(botId, channelId, lines.join("\n"));
          }
        } else {
          await sendBotMessage(botId, channelId, lines.join("\n"));
        }
      }
    } catch (notifyError) {
      console.error("LINE WORKS通知の送信に失敗:", notifyError);
      // 通知失敗でもタスク自体は作成済みなので200を返す
    }

    // 9. レスポンス
    return NextResponse.json({
      success: true,
      taskId: task.id,
      taskTitle,
    });
  } catch (error) {
    console.error("Failed to create schedule task:", error);
    return NextResponse.json(
      { success: false, error: "タスク作成に失敗しました" },
      { status: 500 }
    );
  }
}
