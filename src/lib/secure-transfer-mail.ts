// T-147: セキュアファイル送信のメール本文テンプレート。
// パスワードは本文中で独立した行に置く（コピーしやすくする・確定仕様）。
// 有効期限は必ず JST 表記（formatJstDateTime）。

import { sendResendEmail, SendMailResult } from "@/lib/resend-mail";
import {
  buildTransferNoticeBody,
  formatJstDateTime,
  TRANSFER_MAIL_SUBJECT,
} from "@/lib/secure-transfer-shared";

// 本文テンプレート本体はプレビュー画面（クライアント）と共用のため secure-transfer-shared.ts に移動。
export { buildTransferNoticeBody, TRANSFER_MAIL_SUBJECT };

function getBaseUrl(): string {
  return process.env.PORTAL_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "";
}

export function buildTransferUrl(token: string): string {
  return `${getBaseUrl()}/transfer/${token}`;
}

/**
 * 受信者向け: ファイル送付案内。TO / CC を含む通常のメール1通として送る（2026-08-06 改修）。
 * URL・パスワードは1組で、TO・CC の全受信者が同じものを使う。
 * - to: TO のアドレス（1件以上）。cc: CC のアドレス（0件可）。
 * - subject: 入力された件名をそのまま Subject ヘッダに使う（空欄時は既定文言）。
 *   staging の【検証】プレフィックスは sendResendEmail 側で入力件名にも付与される。
 * - body: 確認画面で編集された（1）本文の最終形（■件名 欄は廃止・本文には出さない）。
 * - signature: 確認画面で編集された（4）署名の最終形（空なら署名なし）。
 */
export async function sendTransferNoticeEmail(params: {
  to: string[];
  cc?: string[];
  senderEmail: string;
  url: string;
  password: string;
  passwordInEmail: boolean;
  expiresAt: Date;
  fileNames: string[];
  subject?: string | null;
  body: string;
  signature: string;
}): Promise<SendMailResult> {
  return sendResendEmail({
    to: params.to,
    cc: params.cc,
    subject: params.subject?.trim() || TRANSFER_MAIL_SUBJECT,
    text: buildTransferNoticeBody(params),
    replyTo: params.senderEmail, // 受信者が返信すると送信者本人に届く
  });
}

/**
 * 送信者向け: 送信控え（2026-08-06 追加）。
 * 受信者への案内メールとは別の1通として送信者本人へ送る（BCC は使わない・確定仕様）。
 *
 * ★パスワードは絶対に載せない（控えに残さない方針）。
 *   「実際に送信した本文の全文」は受信者向けと同じ buildTransferNoticeBody で組み立てるが、
 *   password にはプレースホルダを渡す。passwordInEmail 自体は実際の値を渡すので、
 *   案内文（下記URLを開き…）と ■パスワード 欄の有無は実送信と同じ見え方になる。
 *
 * 件名は「[送信控え] 」+ 実際に送った件名。staging の【検証】は sendResendEmail 側で
 * さらに先頭へ付与されるため、控えにも【検証】が付く。
 * この送信に失敗しても受信者への送信は成功扱いにする（呼び出し側で ok を無視してよい）。
 */
export async function sendTransferCopyEmail(params: {
  to: string; // 送信者（User.email）
  senderName: string;
  recipientEmails: string[]; // TO
  ccEmails: string[]; // CC
  sentAt: Date;
  url: string;
  passwordInEmail: boolean;
  expiresAt: Date;
  fileNames: string[];
  subject: string; // 実際に送った件名（既定文言に解決済みのもの）
  body: string; // （1）本文
  signature: string; // （4）署名
}): Promise<SendMailResult> {
  const lines: string[] = [];
  lines.push(`${params.senderName} 様`);
  lines.push("");
  lines.push("以下の内容でファイルを送信しました。これは送信者控えです。");
  lines.push("※セキュリティのため、この控えにパスワードは記載していません。");
  lines.push("");
  lines.push("──────────");
  lines.push(`■送信日時: ${formatJstDateTime(params.sentAt)}（日本時間）`);
  lines.push(`■件名: ${params.subject}`);
  lines.push(`■宛先(TO): ${params.recipientEmails.join(", ")}`);
  lines.push(`■CC: ${params.ccEmails.length > 0 ? params.ccEmails.join(", ") : "（なし）"}`);
  lines.push(`■有効期限: ${formatJstDateTime(params.expiresAt)} まで（日本時間）`);
  lines.push("■ファイル:");
  for (const name of params.fileNames) {
    lines.push(`・${name}`);
  }
  lines.push(`■ダウンロードURL: ${params.url}`);
  lines.push("──────────");
  lines.push("");
  lines.push("【実際に送信したメール本文】");
  lines.push("");
  lines.push(
    buildTransferNoticeBody({
      body: params.body,
      signature: params.signature,
      url: params.url,
      password: "（控えには記載していません）", // ★平文パスワードを控えに残さない
      passwordInEmail: params.passwordInEmail,
      expiresAt: params.expiresAt,
      fileNames: params.fileNames,
    })
  );

  return sendResendEmail({
    to: params.to,
    subject: `[送信控え] ${params.subject}`,
    text: lines.join("\n"),
  });
}

/**
 * 送信者向け: 期限切れ予告（未ダウンロード）の通知。
 * cleanup cron（JST 04:30）から、明日までに期限が切れる未DL・未無効化の送信について
 * 送信者ごとに1通へまとめて送る。
 */
export async function sendTransferExpiryNoticeEmail(params: {
  to: string; // 送信者（User.email）
  senderName: string;
  items: {
    recipientEmail: string; // TO（複数はカンマ区切り）
    ccEmails?: string | null; // CC（複数はカンマ区切り）。無い送信・旧レコードは null
    subject: string | null;
    expiresAt: Date;
  }[];
}): Promise<SendMailResult> {
  const lines: string[] = [];
  lines.push(`${params.senderName} 様`);
  lines.push("");
  lines.push("以下のファイル送付は有効期限が近づいていますが、相手はまだダウンロードしていません。");
  lines.push("期限を過ぎるとファイルは自動削除され、ダウンロードできなくなります。");
  lines.push("必要に応じて相手への連絡や、期限後の再送をご検討ください。");
  lines.push("");
  for (const item of params.items) {
    lines.push(`・宛先: ${item.recipientEmail}`);
    if (item.ccEmails) lines.push(`　CC: ${item.ccEmails}`);
    if (item.subject) lines.push(`　件名: ${item.subject}`);
    lines.push(`　有効期限: ${formatJstDateTime(item.expiresAt)} まで（日本時間）`);
    lines.push("");
  }
  lines.push("──");
  lines.push("Bizstudio Portal（自動通知）");
  return sendResendEmail({
    to: params.to,
    subject: "【株式会社ビズスタジオ】ファイル送付の有効期限が近づいています（未ダウンロード）",
    text: lines.join("\n"),
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
