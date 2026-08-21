import { sendBotMessage } from "./lineworks";
import { prisma } from "./prisma";

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
      // T-162: 「1名にしか届かない」を後から切り分けられるよう実送信の宛先数を残す
      console.log(
        `[task-notify:create] task=${params.taskId} sent mentions=${mentionLines.length}/${params.assigneeNames.length}`,
      );
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
    console.log(
      `[task-notify:create] task=${params.taskId} sent fallback(no-mention) recipients=${params.assigneeNames.length}`,
    );
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

export type AssigneeNotifyTarget = {
  employeeId: string;
  /** 通知本文の「■ 担当者」に出す表示名（Employee.name） */
  name: string;
  userId: string | null;
  /** メンション可能な場合のみ非 null（User が active かつ lineworksId 登録済み） */
  lineworksId: string | null;
};

/**
 * T-162: 担当者 Employee → User → lineworksId を解決する共通ヘルパー。
 *
 * 従来は各所で User.name の文字列一致だけで引いていたため
 *  - 同名 User がいると別人に飛ぶ
 *  - Employee と User で表記が1文字でも違うとメンションが黙って落ちる
 * という穴があった。Employee.userId のリレーションを第一手段にし、
 * User 未リンクの Employee（本番実測 2名: 藤本 夏海 / 上原 千遥）だけ
 * 従来どおり名前一致でフォールバックする。
 *
 * 返り値は employeeIds の順序を保持する（本文の担当者順とメンション順を一致させるため）。
 * 退職・無効化された User（status !== "active"）は lineworksId を null 扱いにする。
 */
export async function resolveAssigneeNotifyTargets(
  employeeIds: string[],
): Promise<AssigneeNotifyTarget[]> {
  if (employeeIds.length === 0) return [];

  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds } },
    select: {
      id: true,
      name: true,
      user: { select: { id: true, name: true, status: true, lineworksId: true } },
    },
  });

  // User 未リンクの Employee だけ名前一致でフォールバック
  const unlinkedNames = employees.filter((e) => !e.user).map((e) => e.name);
  const fallbackUsers =
    unlinkedNames.length > 0
      ? await prisma.user.findMany({
          where: { name: { in: unlinkedNames }, status: "active" },
          select: { id: true, name: true, lineworksId: true },
        })
      : [];

  const byId = new Map(employees.map((e) => [e.id, e]));

  return employeeIds
    .map((employeeId) => {
      const emp = byId.get(employeeId);
      if (!emp) return null;
      if (emp.user) {
        return {
          employeeId,
          name: emp.name,
          userId: emp.user.id,
          lineworksId: emp.user.status === "active" ? (emp.user.lineworksId ?? null) : null,
        };
      }
      const fb = fallbackUsers.find((u) => u.name === emp.name) ?? null;
      return {
        employeeId,
        name: emp.name,
        userId: fb?.id ?? null,
        lineworksId: fb?.lineworksId ?? null,
      };
    })
    .filter((t): t is AssigneeNotifyTarget => t !== null);
}

/**
 * T-162: 通知の宛先解決結果をログに残す。
 * 「通知が1名にしか届かない」を後から切り分けられるよう、
 * 選択された担当者数・メンションできた人数・落ちた人を必ず1行で出す。
 */
export function logAssigneeNotifyTargets(
  scope: string,
  taskRef: string,
  targets: AssigneeNotifyTarget[],
): void {
  const mentionable = targets.filter((t) => t.lineworksId);
  const skipped = targets.filter((t) => !t.lineworksId);
  console.log(
    `[${scope}] task=${taskRef} assignees=${targets.length} mentionable=${mentionable.length}` +
      ` names=[${targets.map((t) => t.name).join(",")}]`,
  );
  if (skipped.length > 0) {
    console.warn(
      `[${scope}] task=${taskRef} lineworksId 未登録のためメンション対象外: ${skipped
        .map((t) => `${t.name}(user=${t.userId ?? "未リンク"})`)
        .join("、")}`,
    );
  }
}

/**
 * T-177: 日程調整AI（外部RPA）が PATCH /api/external/schedule-tasks/[taskId] で
 * タスクを更新したときの通知に必要な情報。
 */
export type ScheduleAiTaskUpdatedParams = {
  taskId: string;
  title: string;
  candidateName: string | null;
  /** 更新後に **実際にDBへ保存されている** status（読み替え後の値）。 */
  storedStatus: string;
  /** AIが今回追加したコメント本文（AI接頭辞を除いた素の本文）。status のみの更新なら null。 */
  commentContent: string | null;
  assigneeNames: string[];
  assigneeLineworksIds: (string | null)[];
};

const TASK_STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "未着手",
  IN_PROGRESS: "対応中",
  COMPLETED: "完了",
};

/**
 * 通知内リンクは常に **本番ドメイン** へ。PORTAL_BASE_URL はサービスごとに staging/本番 が
 * 異なるため使わない（dailyReport/lineworks-notify.ts と同じ流儀）。
 */
const PORTAL_PROD_URL =
  process.env.PORTAL_PUBLIC_URL || "https://bizstudio-portal-production.up.railway.app";

/**
 * T-177: 日程調整AIがタスクを更新したことを LINE WORKS のタスク通知トークルームへ知らせる。
 *
 * 従来この外部PATCHルートは通知を一切出さない設計だったため、AIが完了化してもCA・事務は
 * 気づけず、一覧から消えたようにしか見えなかった。AIは完了にしなくなった（対応中で残す）ので、
 * 「返信は送った / 完了操作は人がやる」ことを能動的に伝える必要がある。
 *
 * 呼び出し側（PATCHルート）が「そのタスクへのAIの初回更新時のみ」に絞って呼ぶ前提。
 * ここでは二重通知の判定はしない（判定に必要な更新前の状態を持っているのは呼び出し側のため）。
 *
 * @returns 送信したら true / env 未設定でスキップしたら false。送信エラーは throw する
 *          （呼び出し側で握りつぶして 200 を返す＝フェイルソフト）。
 */
export async function notifyScheduleAiTaskUpdated(
  params: ScheduleAiTaskUpdatedParams,
): Promise<boolean> {
  const botId = process.env.LINEWORKS_TASK_BOT_ID;
  const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
  if (!botId || !channelId) {
    console.warn("LINE WORKS タスク通知の環境変数が未設定です");
    return false;
  }

  const statusLabel = TASK_STATUS_LABEL[params.storedStatus] ?? params.storedStatus;
  const commentDisplay = params.commentContent
    ? params.commentContent.length > 200
      ? params.commentContent.slice(0, 200) + "..."
      : params.commentContent
    : "（コメントなし）";

  const header = "日程調整AIが応募者へ返信を送りました（要確認）";

  const baseLines = [
    "🤖 " + header,
    "",
    "■ タスク",
    params.title,
    "",
    "■ 求職者",
    params.candidateName ? params.candidateName + " 様" : "なし",
    "",
    "■ AIのコメント",
    commentDisplay,
    "",
    "■ 現在のステータス",
    statusLabel + "（AIは完了にしません）",
    "",
    "■ お願い",
    "返信内容と日程の確定状況を確認し、問題なければタスクを「完了」にしてください。",
    "AIが返信を送っただけで、面談日程が確定したとは限りません。",
    "",
    "■ 担当者",
    params.assigneeNames.join("、") || "未設定",
    "",
    "🔗 詳細はこちら",
    PORTAL_PROD_URL + "/tasks/" + params.taskId,
  ];

  // 1) lineworksId が登録されている担当者へメンション付き
  const mentionLines = params.assigneeLineworksIds
    .filter((id): id is string => !!id)
    .map((id) => `<m userId="${id}">`);
  if (mentionLines.length > 0) {
    try {
      await sendBotMessage(
        botId,
        channelId,
        [...mentionLines, ` ${header}`, "", ...baseLines.slice(2)].join("\n"),
      );
      return true;
    } catch (e) {
      console.warn("日程調整AI更新通知のメンションに失敗、メンションなしで再送します:", e);
    }
  }

  // 2) 担当者名プレフィックス付き（lineworksId 未登録 or メンション送信失敗）
  if (params.assigneeNames.length > 0) {
    const namePrefix = params.assigneeNames.map((n) => `${n}さん`).join("、");
    await sendBotMessage(
      botId,
      channelId,
      [`${namePrefix} ${header}`, "", ...baseLines.slice(2)].join("\n"),
    );
    return true;
  }

  // 3) 素の本文
  await sendBotMessage(botId, channelId, baseLines.join("\n"));
  return true;
}
