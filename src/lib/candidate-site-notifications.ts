// T-133 P2: まとめ送信時の求職者回答通知フック（P3 で中身を移植する）。
//
// 箱B（kyuujinPDF）の POST /{token}/submit は送信時に以下2通知を発火していた:
//   ① LINE WORKS マイページBot 通知（気になる/応募したい の求人一覧をチャンネルへ）
//   ② Resend メール通知（同内容をメールで担当CAへ）
// P2 では発火点（response-submission API 内の呼び出し）だけを確定させ、実送信は行わない。
//
// TODO(P3): 箱B backend/app/routers/mypage.py の submit_feedback 内
//   _build_notification_message / interested_jobs_data / apply_jobs_data 相当の整形と、
//   LINE WORKS 送信（portal 既存 src/lib/lineworks.ts の sendBotMessage を流用。Bot/チャンネルは
//   タスクBot(LINEWORKS_TASK_BOT_ID)とは別の「マイページBot」用 env を追加予定）、
//   Resend 送信（要 env: RESEND_API_KEY / 送信元・宛先設定。kyuujin 側の実装を移植）を実装する。

export type SubmissionJobSummary = {
  companyName: string | null;
  fileName: string;
  responseStatus: string; // 送信時点の仕分け（INTERESTED / APPLY / PENDING）
};

export type SubmissionNotificationPayload = {
  candidateId: string;
  candidateNumber: string | null;
  candidateName: string;
  submissionId: string;
  interestedCount: number;
  applyCount: number;
  jobs: SubmissionJobSummary[];
};

/** ① LINE WORKS マイページBot 通知。P2 では no-op（P3 で実装）。 */
export async function notifySubmissionViaLineWorks(
  payload: SubmissionNotificationPayload,
): Promise<void> {
  // TODO(P3): LINE WORKS マイページBot への実送信を実装（上記ヘッダコメント参照）。
  console.log(
    `[candidate-site-notifications] (no-op P2) LINE WORKS hook called: submission=${payload.submissionId} interested=${payload.interestedCount} apply=${payload.applyCount}`,
  );
}

/** ② Resend メール通知。P2 では no-op（P3 で実装）。 */
export async function notifySubmissionViaResendEmail(
  payload: SubmissionNotificationPayload,
): Promise<void> {
  // TODO(P3): Resend でのメール送信を実装（要 RESEND_API_KEY ほか。上記ヘッダコメント参照）。
  console.log(
    `[candidate-site-notifications] (no-op P2) Resend hook called: submission=${payload.submissionId}`,
  );
}
