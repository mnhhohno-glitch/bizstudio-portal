import { sendBotMessageWithCaMention, type CaMentionTarget } from "@/lib/lineworks-ca-mention";

// T-128 batch4: 求職者サイトからの「担当CAへの質問」を担当CAへ LINE WORKS 通知する。
// 応募通知（src/lib/candidate-site/apply-notification.ts）で現に稼働している経路をそのまま流用:
// - 送信先: LINEWORKS_TASK_BOT_ID / LINEWORKS_TASK_CHANNEL_ID（既存CA通知チャンネル）。
// - 2026-09-26: 宛先を Employee.lineUserId（LINE のIDで LINE WORKS には効かない）から
//   User.lineworksId に変更（lineworks-ca-mention.ts・応募通知と同一）。届かないときは代表へメンション＋本文末尾に注記。
//   代表も引けないときはメンションなし（担当CA名プレフィックス）＋注記。

type QuestionNotificationParams = {
  candidateName: string;
  candidateNumber: string;
  target: CaMentionTarget;
  taskId: string;
  question: string;
  summary: string;
  // T-133 FU-11: 対象求人（求人紐付き質問のみ。全体質問は null）。
  jobRef?: string | null; // 求人No（externalJobRef）
  jobTitle?: string | null;
  jobCompany?: string | null;
};

/**
 * 質問通知を送信する。成功で true、環境変数未設定で false（例外にしない）、送信失敗は throw。
 */
export async function notifyCandidateQuestion(
  params: QuestionNotificationParams
): Promise<boolean> {
  const botId = process.env.LINEWORKS_TASK_BOT_ID;
  const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
  const baseUrl = process.env.PORTAL_BASE_URL;

  if (!botId || !channelId) {
    console.warn("[candidate-site/questions] LINE WORKS 環境変数が未設定のため通知をスキップ");
    return false;
  }

  const caName = params.target.caName;

  // T-133 FU-11: 対象求人（求人紐付き質問のみ）。求職者ブロックの直後に1ブロック挿入。
  // 求人番号が無くても会社名・求人タイトルが来ていれば出す（タスク件名・メモ側と同一の判定）。
  // 表記はタスク詳細（questions/route.ts の「■ 対象求人」）と揃える。
  const targetJobDetails = [
    ...(params.jobRef ? [`求人番号: ${params.jobRef}`] : []),
    ...(params.jobCompany ? [`企業名: ${params.jobCompany}`] : []),
    ...(params.jobTitle ? [`求人タイトル: ${params.jobTitle}`] : []),
  ];
  const targetJobLines = targetJobDetails.length
    ? ["", "■ 対象求人", ...targetJobDetails]
    : [];

  const baseLines = [
    "❓ 求職者から担当CAへの質問が届きました",
    "",
    "■ 求職者",
    `${params.candidateName} 様（${params.candidateNumber}）`,
    ...targetJobLines,
    "",
    "■ 質問内容",
    params.question,
    "",
    "■ 要約",
    params.summary,
    "",
    "■ 担当CA",
    caName ?? "未設定",
  ];
  if (baseUrl) {
    baseLines.push("", "🔗 タスク詳細", `${baseUrl}/tasks/${params.taskId}`);
  }

  const header = "求職者サイトから質問が届きました";

  await sendBotMessageWithCaMention(
    botId,
    channelId,
    params.target,
    (mentionId, note) => {
      const tail = note ? [note] : [];
      if (mentionId) {
        // 見出し行＋空行をスキップ
        return [`<m userId="${mentionId}">`, ` ${header}`, "", ...baseLines.slice(2), ...tail].join("\n");
      }
      // メンションなし。担当CA名を先頭に付ける。
      const prefix = caName ? `${caName}さん ` : "";
      return [`${prefix}${header}`, "", ...baseLines.slice(2), ...tail].join("\n");
    },
    "candidate-site/questions",
  );
  return true;
}
