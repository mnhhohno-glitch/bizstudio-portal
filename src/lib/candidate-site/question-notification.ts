import { sendBotMessage } from "@/lib/lineworks";

// T-128 batch4: 求職者サイトからの「担当CAへの質問」を担当CAへ LINE WORKS 通知する。
// 応募通知（src/lib/candidate-site/apply-notification.ts）で現に稼働している経路をそのまま流用:
// - 送信先: LINEWORKS_TASK_BOT_ID / LINEWORKS_TASK_CHANNEL_ID（既存CA通知チャンネル）。
// - メンション宛先: 応募通知が実際に使っているのと同じ Employee.lineUserId（apply/route.ts が
//   ca.employee.lineUserId を caLineworksId として渡し、apply-notification が <m userId> に使う）。
//   無ければ担当CA名プレフィックスでフォールバック。

type QuestionNotificationParams = {
  candidateName: string;
  candidateNumber: string;
  caName: string | null;
  caLineUserId: string | null; // Employee.lineUserId（応募通知と同一の宛先）
  taskId: string;
  question: string;
  summary: string;
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

  const baseLines = [
    "❓ 求職者から担当CAへの質問が届きました",
    "",
    "■ 求職者",
    `${params.candidateName} 様（${params.candidateNumber}）`,
    "",
    "■ 質問（原文）",
    params.question,
    "",
    "■ 要約",
    params.summary,
    "",
    "■ 担当CA",
    params.caName ?? "未設定",
  ];
  if (baseUrl) {
    baseLines.push("", "🔗 タスク詳細", `${baseUrl}/tasks/${params.taskId}`);
  }

  const header = "求職者サイトから質問が届きました";

  // メンション（lineUserId があれば）。
  if (params.caLineUserId) {
    const mentioned = [
      `<m userId="${params.caLineUserId}">`,
      ` ${header}`,
      "",
      ...baseLines.slice(2), // 見出し行＋空行をスキップ
    ];
    try {
      await sendBotMessage(botId, channelId, mentioned.join("\n"));
      return true;
    } catch (e) {
      console.warn("[candidate-site/questions] メンション通知に失敗、メンションなしで再送します:", e);
    }
  }

  // メンションなし（lineUserId 未登録 or メンション送信失敗時 or 担当CA未設定）。
  const prefix = params.caName ? `${params.caName}さん ` : "";
  const fallback = [`${prefix}${header}`, "", ...baseLines.slice(2)];
  await sendBotMessage(botId, channelId, fallback.join("\n"));
  return true;
}
