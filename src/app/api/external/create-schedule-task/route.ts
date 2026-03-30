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
  source?: string;
}

type AssigneeInfo = {
  userId: string;
  employeeId: string;
  name: string;
  lineworksId: string | null;
};

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
      source,
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
        taskTitle = source
          ? `【${source} 新規面談調整】新規応募者 ${candidateName}`
          : `【新規面談調整】新規応募者 ${candidateName}`;
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
    const assignees: AssigneeInfo[] = [];

    if (type !== "mynavi_new" && advisorName) {
      // advisorName から User を検索
      const advisorUser = await prisma.user.findFirst({
        where: { name: advisorName, status: "active" },
        include: { employee: { select: { id: true, name: true } } },
      });
      if (advisorUser) {
        let employeeId = advisorUser.employee?.id;
        // User→Employee リレーション未リンク時は名前でフォールバック
        if (!employeeId) {
          const emp = await prisma.employee.findFirst({
            where: { name: advisorName, status: "active" },
            select: { id: true },
          });
          employeeId = emp?.id;
        }
        if (employeeId) {
          assignees.push({
            userId: advisorUser.id,
            employeeId,
            name: advisorUser.employee?.name ?? advisorUser.name,
            lineworksId: advisorUser.lineworksId,
          });
        }
      }
    }

    // mynavi_new の場合、または advisorName が見つからなかった場合 → マイナビ管理担当全員
    if (assignees.length === 0) {
      const mynaviUsers = await prisma.user.findMany({
        where: { isMynaviAssignee: true, status: "active" },
        include: { employee: { select: { id: true, name: true } } },
      });
      for (const u of mynaviUsers) {
        let employeeId = u.employee?.id;
        let employeeName = u.employee?.name ?? u.name;

        // User→Employee リレーションが未リンクの場合、名前でEmployee検索
        if (!employeeId) {
          const emp = await prisma.employee.findFirst({
            where: { name: u.name, status: "active" },
            select: { id: true, name: true },
          });
          if (emp) {
            employeeId = emp.id;
            employeeName = emp.name;
          }
        }

        if (employeeId) {
          assignees.push({
            userId: u.id,
            employeeId,
            name: employeeName,
            lineworksId: u.lineworksId,
          });
        }
      }
    }

    if (assignees.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "マイナビ管理担当が設定されていません。社員管理画面で設定してください。",
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

    // 6. Task作成（completionType: "any" = 誰か1人が完了したらタスク完了）
    const createdByUserId = assignees[0].userId;

    const task = await prisma.task.create({
      data: {
        title: taskTitle,
        status: "NOT_STARTED",
        categoryId: category.id,
        candidateId: candidateId || null,
        createdByUserId,
        completionType: "any",
        assignees: {
          create: assignees.map((a) => ({ employeeId: a.employeeId })),
        },
        fieldValues: {
          create: fieldValuesData,
        },
      },
    });

    // 7. LINE WORKS通知
    try {
      const botId = process.env.LINEWORKS_TASK_BOT_ID;
      const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
      const baseUrl = process.env.PORTAL_BASE_URL;

      if (botId && channelId) {
        const assigneeNamesStr = assignees.map((a) => a.name).join("、");

        const lines = [
          "📋 タスクが自動生成されました",
          "",
          "■ タイトル",
          taskTitle,
          "",
          "■ カテゴリ",
          "日程調整",
          "",
          "■ 担当者",
          assigneeNamesStr,
          "",
          "■ ステータス",
          "未着手",
          "",
          "■ 希望日時",
          preferredDates,
          "",
          "■ 面談形式",
          meetingFormat,
        ];

        if (notes) {
          lines.push("", "■ 備考", notes);
        }

        lines.push("", "🔗 タスク詳細", `${baseUrl}/tasks/${task.id}`);

        // メンション付き通知を試行
        const mentionLines = assignees
          .filter((a) => a.lineworksId)
          .map((a) => `<m userId="${a.lineworksId}">`);

        if (mentionLines.length > 0) {
          const mentionedLines = [
            ...mentionLines,
            " タスクが自動生成されました",
            "",
            ...lines.slice(2),
          ];
          try {
            await sendBotMessage(botId, channelId, mentionedLines.join("\n"));
          } catch {
            await sendBotMessage(botId, channelId, lines.join("\n"));
          }
        } else {
          await sendBotMessage(botId, channelId, lines.join("\n"));
        }
      }
    } catch (notifyError) {
      console.error("LINE WORKS通知の送信に失敗:", notifyError);
    }

    // 8. レスポンス
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
