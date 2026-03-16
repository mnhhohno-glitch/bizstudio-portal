import { sendBotMessage } from "./lineworks";

type TaskNotificationParams = {
  taskId: string;
  title: string;
  categoryName: string | null;
  candidateName: string | null;
  assigneeNames: string[];
  assigneeLineworksIds: (string | null)[];
  priority: string | null;
  dueDate: Date | null;
  creatorName: string;
};

const PRIORITY_LABEL: Record<string, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};

/**
 * タスク作成時にLINE WORKSのタスク通知トークルームにメッセージを送信
 */
export async function notifyTaskCreated(params: TaskNotificationParams): Promise<void> {
  const botId = process.env.LINEWORKS_TASK_BOT_ID;
  const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
  const baseUrl = process.env.PORTAL_BASE_URL;

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

  // メンションなしの基本メッセージ行
  const baseLines = [
    "📋 タスクが作成されました",
    "",
    "■ タスク",
    params.title,
    "",
    "■ カテゴリ",
    params.categoryName ?? "未設定",
    "",
    "■ 求職者",
    params.candidateName ? `${params.candidateName} 様` : "なし",
    "",
    "■ 担当者",
    params.assigneeNames.join("、") || "未設定",
    "",
    "■ 優先度",
    params.priority ? (PRIORITY_LABEL[params.priority] ?? params.priority) : "未設定",
    "",
    "■ 期限",
    dueDateStr,
    "",
    "■ 作成者",
    params.creatorName,
    "",
    "🔗 詳細はこちら",
    `${baseUrl}/tasks/${params.taskId}`,
  ];

  // lineworksIdが登録されている担当者のメンション行を作成
  const mentionLines = params.assigneeLineworksIds
    .filter((id): id is string => !!id)
    .map((id) => `<m userId="${id}">`);

  if (mentionLines.length > 0) {
    const mentionedLines = [
      ...mentionLines,
      " 新しいタスクが割り当てられました",
      "",
      ...baseLines.slice(2), // "📋 タスクが作成されました" と空行をスキップ
    ];
    try {
      await sendBotMessage(botId, channelId, mentionedLines.join("\n"));
      return;
    } catch (e) {
      console.warn("メンション付き通知に失敗、メンションなしで再送します:", e);
    }
  }

  // メンションなし（lineworksId未登録 or メンション送信失敗時）
  // 担当者名を先頭に付ける
  if (params.assigneeNames.length > 0) {
    const namePrefix = params.assigneeNames.map((n) => `${n}さん`).join("、");
    const fallbackLines = [
      `${namePrefix} 新しいタスクが割り当てられました`,
      "",
      ...baseLines.slice(2),
    ];
    await sendBotMessage(botId, channelId, fallbackLines.join("\n"));
    return;
  }

  await sendBotMessage(botId, channelId, baseLines.join("\n"));
}

type TaskCompletedParams = {
  taskId: string;
  title: string;
  categoryName: string | null;
  candidateName: string | null;
  candidateNumber: string | null;
  completedByName: string;
  creatorLineworksId: string | null;
  creatorName: string;
};

/**
 * タスク完了時にLINE WORKSのタスク通知トークルームにメッセージを送信
 */
export async function notifyTaskCompleted(params: TaskCompletedParams): Promise<void> {
  const botId = process.env.LINEWORKS_TASK_BOT_ID;
  const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
  const baseUrl = process.env.PORTAL_BASE_URL;

  if (!botId || !channelId) return;

  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const candidateStr = params.candidateName
    ? `${params.candidateName}${params.candidateNumber ? `（${params.candidateNumber}）` : ""}`
    : "なし";

  const baseLines = [
    "✅ タスクが完了しました",
    "",
    "■ タスク",
    params.title,
    "",
    "■ カテゴリ",
    params.categoryName ?? "未設定",
    "",
    "■ 求職者",
    candidateStr,
    "",
    "■ 完了者",
    params.completedByName,
    "",
    "■ 完了日時",
    now,
    "",
    "🔗 詳細はこちら",
    `${baseUrl}/tasks/${params.taskId}`,
  ];

  // 作成者にメンション
  if (params.creatorLineworksId) {
    const mentionedLines = [
      `<m userId="${params.creatorLineworksId}"> タスクが完了しました`,
      "",
      ...baseLines.slice(2),
    ];
    try {
      await sendBotMessage(botId, channelId, mentionedLines.join("\n"));
      return;
    } catch {
      // fallback
    }
  }

  // メンションなし
  const fallbackLines = [
    `${params.creatorName}さん タスクが完了しました`,
    "",
    ...baseLines.slice(2),
  ];
  await sendBotMessage(botId, channelId, fallbackLines.join("\n"));
}
