// T-147: セキュアファイル送信のメール本文テンプレート。
// パスワードは本文中で独立した行に置く（コピーしやすくする・確定仕様）。
// 有効期限は必ず JST 表記（formatJstDateTime）。

import { sendResendEmail, SendMailResult } from "@/lib/resend-mail";
import { formatJstDateTime } from "@/lib/secure-transfer";

function getBaseUrl(): string {
  return process.env.PORTAL_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "";
}

export function buildTransferUrl(token: string): string {
  return `${getBaseUrl()}/transfer/${token}`;
}

/** 受信者向け: ファイル送付案内（URL・パスワード・期限・ファイル名一覧・送信者名）。 */
export function buildTransferNoticeBody(params: {
  senderName: string;
  senderEmail: string;
  url: string;
  password: string;
  passwordInEmail: boolean; // false = パスワードは本文に載せず「別途お伝えします」と記載
  expiresAt: Date;
  fileNames: string[];
  subject?: string | null;
  message?: string | null;
}): string {
  const lines: string[] = [];
  lines.push("ご担当者様");
  lines.push("");
  lines.push("株式会社ビズスタジオよりファイルをお送りいたします。");
  lines.push("下記URLを開き、パスワードを入力のうえ、有効期限までにダウンロードをお願いいたします。");
  lines.push("");
  if (params.subject) {
    lines.push(`■件名`);
    lines.push(params.subject);
    lines.push("");
  }
  lines.push("■ダウンロードURL");
  lines.push(params.url);
  lines.push("");
  lines.push("■パスワード");
  if (params.passwordInEmail) {
    // パスワードの行は前後に空行を置き、コピーしやすくする（確定仕様）
    lines.push("");
    lines.push(params.password);
    lines.push("");
  } else {
    lines.push("パスワードは送信者より別途お伝えします。");
  }
  lines.push("");
  lines.push("■有効期限");
  lines.push(`${formatJstDateTime(params.expiresAt)} まで（日本時間）`);
  lines.push("");
  lines.push("■ファイル");
  for (const name of params.fileNames) {
    lines.push(`・${name}`);
  }
  if (params.message) {
    lines.push("");
    lines.push(params.message);
  }
  lines.push("");
  lines.push("※有効期限を過ぎるとファイルは自動的に削除され、ダウンロードできなくなります。");
  lines.push("※本メールに心当たりがない場合は、お手数ですが破棄してください。");
  lines.push("");
  lines.push("──");
  lines.push(`株式会社ビズスタジオ ${params.senderName}`);
  lines.push(params.senderEmail);
  return lines.join("\n");
}

export async function sendTransferNoticeEmail(params: {
  to: string;
  senderName: string;
  senderEmail: string;
  url: string;
  password: string;
  passwordInEmail: boolean;
  expiresAt: Date;
  fileNames: string[];
  subject?: string | null;
  message?: string | null;
}): Promise<SendMailResult> {
  return sendResendEmail({
    to: params.to,
    subject: "【株式会社ビズスタジオ】ファイル送付のご案内",
    text: buildTransferNoticeBody(params),
    replyTo: params.senderEmail, // 受信者が返信すると送信者本人に届く
  });
}

/** 送信者向け: パスワード10回失敗による自動無効化の通知。 */
export async function sendTransferLockedEmail(params: {
  to: string; // 送信者（User.email）
  senderName: string;
  recipientEmail: string;
  subject?: string | null;
  createdAt: Date;
}): Promise<SendMailResult> {
  const lines: string[] = [];
  lines.push(`${params.senderName} 様`);
  lines.push("");
  lines.push("以下のファイル送付リンクで、パスワードの入力失敗が規定回数（10回）に達したため、");
  lines.push("リンクを自動的に無効化しました。ファイルはダウンロードできない状態になっています。");
  lines.push("");
  lines.push(`・宛先: ${params.recipientEmail}`);
  if (params.subject) lines.push(`・件名: ${params.subject}`);
  lines.push(`・送信日時: ${formatJstDateTime(params.createdAt)}（日本時間）`);
  lines.push("");
  lines.push("誤操作の可能性がある場合は、ポータルの「ファイル送信」から新しいリンクを発行して再送してください。");
  lines.push("心当たりのない失敗が続いている場合は、管理者へ相談してください。");
  lines.push("");
  lines.push("──");
  lines.push("Bizstudio Portal（自動通知）");
  return sendResendEmail({
    to: params.to,
    subject: "【株式会社ビズスタジオ】ファイル送付リンクを自動無効化しました",
    text: lines.join("\n"),
  });
}
