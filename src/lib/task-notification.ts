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
  /**
   * T-151: 起票の経路（例: "AIアドバイザーの会話" / "面談ログの解析"）。
   * 見出しは経路非依存にし、経路はこの1行で伝える。未指定なら経路行を出さない。
   */
  originLabel?: string;
};

/**
 * T-150: AI が検出した約束から起票されたタスクの作成通知。
 * T-151 で面談ログ経路が加わったため、見出しは経路非依存にし、経路は originLabel の1行で伝える。
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
    "🤖 AIが検出した約束からタスクが作成されました",
    "",
    ...(params.originLabel ? ["■ 検出元", params.originLabel, ""] : []),
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

  const header = "AIが検出した約束から新しいタスクが作成されました";

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

export type DueReminderItem = {
  taskId: string;
  title: string;
  candidateName: string | null;
  /** "YYYY-MM-DD"（JST 暦日） */
  dueDate: string;
  /** 0 以下 = 期日当日 / 1 以上 = 超過日数 */
  overdueDays: number;
  assignee: string | null;
};

type AiTaskDueReminderParams = {
  jstToday: string;
  items: DueReminderItem[];
  /** 上限で本文から畳んだ件数。 */
  truncated: number;
  assigneeNames: string[];
  assigneeLineworksIds: string[];
};

/** "2026-08-07" → "2026/08/07"（既存通知の toLocaleDateString("ja-JP") 表記に合わせる） */
function ymdSlash(ymd: string): string {
  return ymd.replace(/-/g, "/");
}

/**
 * T-150: AI起票タスクの期日リマインド。期日当日の朝と、期日超過中の毎朝に送る。
 *
 * - 期日当日と超過を見出しで分け、超過は「N日超過」を各行に出す。
 * - 複数件あっても1通にまとめる（1件ごとに飛ばすと通知過多で無視される）。
 * - メンション不可時は既存 notifyTaskCreated と同じ3段フォールバック
 *   （実測で active 9名中2名が lineworksId 未設定）。
 */
export async function notifyAiTaskDueReminder(params: AiTaskDueReminderParams): Promise<void> {
  const botId = process.env.LINEWORKS_TASK_BOT_ID;
  const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
  const baseUrl = process.env.PORTAL_BASE_URL;

  if (!botId || !channelId) {
    console.warn("LINE WORKS タスク通知の環境変数が未設定です");
    return;
  }
  if (params.items.length === 0) return;

  const line = (i: DueReminderItem) => {
    const who = i.candidateName ? `${i.candidateName} 様` : "求職者なし";
    const assignee = i.assignee ? ` / 担当 ${i.assignee}` : "";
    const over = i.overdueDays > 0 ? ` ・${i.overdueDays}日超過` : "";
    return `・${i.title}（${who}${assignee} / 期日 ${ymdSlash(i.dueDate)}${over}）`;
  };

  const todayItems = params.items.filter((i) => i.overdueDays <= 0);
  const overdueItems = params.items.filter((i) => i.overdueDays > 0);

  const baseLines: string[] = [
    "⏰ 期日のタスクがあります（AI起票分）",
    "",
  ];
  if (todayItems.length > 0) {
    baseLines.push(`■ 本日が期日（${todayItems.length}件）`, ...todayItems.map(line), "");
  }
  if (overdueItems.length > 0) {
    baseLines.push(`■ 期日超過（${overdueItems.length}件）`, ...overdueItems.map(line), "");
  }
  if (params.truncated > 0) {
    baseLines.push(`…ほか ${params.truncated} 件（多いため省略）`, "");
  }
  baseLines.push("🔗 タスク一覧", `${baseUrl}/tasks`);

  const header = "期日のタスクがあります";

  // 1) lineworksId があるユーザーだけメンション
  const mentionLines = params.assigneeLineworksIds.filter(Boolean).map((id) => `<m userId="${id}">`);
  if (mentionLines.length > 0) {
    try {
      await sendBotMessage(
        botId,
        channelId,
        [...mentionLines, ` ${header}`, "", ...baseLines.slice(2)].join("\n"),
      );
      return;
    } catch (e) {
      console.warn("期日リマインドのメンションに失敗、メンションなしで再送します:", e);
    }
  }

  // 2) 担当者名があれば名前プレフィックス付き
  if (params.assigneeNames.length > 0) {
    const namePrefix = params.assigneeNames.map((n) => `${n}さん`).join("、");
    await sendBotMessage(
      botId,
      channelId,
      [`${namePrefix} ${header}`, "", ...baseLines.slice(2)].join("\n"),
    );
    return;
  }

  // 3) 素の本文
  await sendBotMessage(botId, channelId, baseLines.join("\n"));
}
