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

  const assignHeader = `${params.creatorName}から新しいタスクが割り当てられました`;

  // lineworksIdが登録されている担当者のメンション行を作成
  const mentionLines = params.assigneeLineworksIds
    .filter((id): id is string => !!id)
    .map((id) => `<m userId="${id}">`);

  if (mentionLines.length > 0) {
    const mentionedLines = [
      ...mentionLines,
      ` ${assignHeader}`,
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
      `${namePrefix} ${assignHeader}`,
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
  // 通知先（完了者以外の担当者 + 作成者）
  recipientNames: string[];
  recipientLineworksIds: (string | null)[];
};

/**
 * タスク完了時にLINE WORKSのタスク通知トークルームにメッセージを送信
 * メンション先: 完了者以外の担当者 + 作成者（重複排除済み）
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

  // メンション付き通知
  const mentionLines = params.recipientLineworksIds
    .filter((id): id is string => !!id)
    .map((id) => `<m userId="${id}">`);

  if (mentionLines.length > 0) {
    const mentionedLines = [
      ...mentionLines,
      ` ${params.completedByName}がタスクを完了しました`,
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
  if (params.recipientNames.length > 0) {
    const namePrefix = params.recipientNames.map((n) => `${n}さん`).join("、");
    const fallbackLines = [
      `${namePrefix} ${params.completedByName}がタスクを完了しました`,
      "",
      ...baseLines.slice(2),
    ];
    await sendBotMessage(botId, channelId, fallbackLines.join("\n"));
    return;
  }

  await sendBotMessage(botId, channelId, baseLines.join("\n"));
}

type TaskCommentParams = {
  taskId: string;
  title: string;
  categoryName: string | null;
  candidateName: string | null;
  commentContent: string;
  commentedAt: Date;
  commenterName: string;
  commenterId: string;
  recipientLineworksIds: (string | null)[];
  recipientNames: string[];
};

/**
 * タスクコメント投稿時にLINE WORKSのタスク通知トークルームにメッセージを送信
 */
export async function notifyTaskComment(params: TaskCommentParams): Promise<void> {
  const botId = process.env.LINEWORKS_TASK_BOT_ID;
  const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
  const baseUrl = process.env.PORTAL_BASE_URL;

  if (!botId || !channelId) return;

  const commentDisplay =
    params.commentContent.length > 200
      ? params.commentContent.slice(0, 200) + "..."
      : params.commentContent;

  const commentedAtStr = new Date(params.commentedAt).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
  });

  const baseLines = [
    `💬 ${params.commenterName}がタスクにコメントしました`,
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
    "■ コメント",
    commentDisplay,
    "",
    "■ 投稿日時",
    commentedAtStr,
    "",
    "🔗 詳細はこちら",
    `${baseUrl}/tasks/${params.taskId}`,
  ];

  // メンション対象（投稿者自身は除外済みの前提）
  const mentionLines = params.recipientLineworksIds
    .filter((id): id is string => !!id)
    .map((id) => `<m userId="${id}">`);

  if (mentionLines.length > 0) {
    const mentionedLines = [
      ...mentionLines,
      ` ${params.commenterName}がタスクにコメントしました`,
      "",
      ...baseLines.slice(2),
    ];
    try {
      await sendBotMessage(botId, channelId, mentionedLines.join("\n"));
      return;
    } catch (e) {
      console.warn("コメント通知のメンションに失敗、メンションなしで再送します:", e);
    }
  }

  // メンションなし
  if (params.recipientNames.length > 0) {
    const namePrefix = params.recipientNames.map((n) => `${n}さん`).join("、");
    const fallbackLines = [
      `${namePrefix} ${params.commenterName}がタスクにコメントしました`,
      "",
      ...baseLines.slice(2),
    ];
    await sendBotMessage(botId, channelId, fallbackLines.join("\n"));
    return;
  }

  await sendBotMessage(botId, channelId, baseLines.join("\n"));
}

type AiTaskCreatedParams = {
  taskId: string;
  title: string;
  categoryLabel: string;
  candidateName: string;
  assigneeName: string | null;
  assigneeLineworksId: string | null;
  dueDate: Date | null;
  /** カード上で「タスクを作成」を押した CA。 */
  actorName: string;
};

/**
 * T-150: AIアドバイザーの会話から起票されたタスクの作成通知。
 *
 * 既存 notifyTaskCreated を使わず専用関数にしている理由:
 *  - notifyTaskCreated 側の担当者引き当ては「ユーザー名の文字列一致」（tasks/route.ts の
 *    where: { name: { in: assigneeNames } }）で、同名ユーザーがいると誤爆する。
 *    T-150 は担当CAが確定しているので employee.user.lineworksId を直接受け取る。
 *  - 「作成者」が AI なのか操作CAなのか曖昧になるため、文面を専用に書く。
 * 先例: mypage-response-sync.ts の notifyMypageResponse（自動生成タスク専用の通知）。
 *
 * メンション不可時は notifyTaskCreated と同じ3段フォールバックを踏襲する
 * （実測で active 9名中2名が lineworksId 未設定）。
 */
export async function notifyAiTaskCreated(params: AiTaskCreatedParams): Promise<void> {
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

  const baseLines = [
    "🤖 AIアドバイザーの会話からタスクが作成されました",
    "",
    "■ タスク",
    params.title,
    "",
    "■ 種別",
    params.categoryLabel,
    "",
    "■ 求職者",
    `${params.candidateName} 様`,
    "",
    "■ 担当者",
    params.assigneeName ?? "未設定",
    "",
    "■ 期限",
    dueDateStr,
    "",
    "■ 作成操作",
    `${params.actorName}（確認のうえ作成）`,
    "",
    "🔗 詳細はこちら",
    `${baseUrl}/tasks/${params.taskId}`,
  ];

  const header = "AIアドバイザーの会話から新しいタスクが作成されました";

  // 1) lineworksId があればメンション付き
  if (params.assigneeLineworksId) {
    try {
      await sendBotMessage(
        botId,
        channelId,
        [`<m userId="${params.assigneeLineworksId}">`, ` ${header}`, "", ...baseLines.slice(2)].join("\n"),
      );
      return;
    } catch (e) {
      console.warn("メンション付き通知に失敗、メンションなしで再送します:", e);
    }
  }

  // 2) 担当者名があれば名前プレフィックス付きでメンションなし
  if (params.assigneeName) {
    await sendBotMessage(
      botId,
      channelId,
      [`${params.assigneeName}さん ${header}`, "", ...baseLines.slice(2)].join("\n"),
    );
    return;
  }

  // 3) 素の本文
  await sendBotMessage(botId, channelId, baseLines.join("\n"));
}
