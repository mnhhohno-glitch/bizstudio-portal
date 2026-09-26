import { sendBotMessageWithCaMention, type CaMentionTarget } from "@/lib/lineworks-ca-mention";

// T-128 T2: 求職者サイトからの応募を担当CAへ LINE WORKS 通知する。
// 既存のタスク通知（src/lib/task-notification.ts）と同じ Bot/トークルーム・メンション方式に従う。
// - 送信先: LINEWORKS_TASK_BOT_ID / LINEWORKS_TASK_CHANNEL_ID（既存CA通知チャンネル）。
// - 2026-09-26: 宛先を Employee.lineUserId（LINE のIDで LINE WORKS には効かない）から
//   User.lineworksId に変更（lineworks-ca-mention.ts）。届かないときは代表へメンション＋本文末尾に注記。
//   代表も引けないときはメンションなし（担当CA名プレフィックス）＋注記。

type ApplyNotificationParams = {
  candidateId: string;
  candidateName: string;
  candidateNumber: string;
  target: CaMentionTarget;
  jobTitle: string | null;
  companyName: string | null;
  externalJobRef: string;
};

/**
 * 応募通知を送信する。成功で resolve、失敗は throw（呼び出し側で try/catch し応募記録は残す）。
 * 環境変数未設定時は送信せず false 相当（例外にせず、呼び出し側で notifiedAt を立てない扱いにする）。
 * 返り値: true=送信した / false=環境変数未設定でスキップ。
 */
export async function notifyCandidateApplication(
  params: ApplyNotificationParams
): Promise<boolean> {
  const botId = process.env.LINEWORKS_TASK_BOT_ID;
  const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
  const baseUrl = process.env.PORTAL_BASE_URL;

  if (!botId || !channelId) {
    console.warn("[candidate-site/apply] LINE WORKS 環境変数が未設定のため通知をスキップ");
    return false;
  }

  const caName = params.target.caName;
  const jobLine = [params.companyName, params.jobTitle].filter(Boolean).join(" / ") || "(求人情報なし)";

  const baseLines = [
    "📮 求職者が求人に応募しました",
    "",
    "■ 求職者",
    `${params.candidateName} 様（${params.candidateNumber}）`,
    "",
    "■ 応募求人",
    jobLine,
    "",
    "■ 求人ID",
    params.externalJobRef,
    "",
    "■ 担当CA",
    caName ?? "未設定",
  ];
  if (baseUrl) {
    baseLines.push("", "🔗 求職者ページ", `${baseUrl}/candidates/${params.candidateId}`);
  }

  const header = "求職者サイトから応募がありました";

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
    "candidate-site/apply",
  );
  return true;
}
