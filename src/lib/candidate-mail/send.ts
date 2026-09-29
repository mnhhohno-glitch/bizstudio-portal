// T-207: 求職者向け案内メールの「送れるか判定」「確認用の組み立て」「送信＋記録」。サーバ専用。
// API ルート（/api/candidates/[candidateId]/contact-mail）から呼ぶ。
// あとで作る初回面談の台本のボタンからも、同じ関数を通す前提（文面・判定・記録を1か所に置く）。

import { prisma } from "@/lib/prisma";
import { buildSenderFrom, sendResendEmail } from "@/lib/resend-mail";
import type { CandidateContactMailType } from "@prisma/client";
import {
  buildContactMail,
  caFamilyNameOf,
  CONTACT_MAIL_TYPES,
  LINE_QR_CID,
  requiresLineWorksUrl,
  type ContactMailType,
} from "./templates";
import { buildQrDataUrl, buildQrPngBuffer } from "./qr";

/** API の種類 → DB enum */
export const CONTACT_MAIL_DB_TYPE: Record<ContactMailType, CandidateContactMailType> = {
  line: "LINE_GUIDE",
  greeting: "GREETING",
};

export type ContactMailSender = {
  userId: string;
  email: string;
  /** 表示名の元（Employee.name があればそれ、無ければ User.name） */
  name: string;
  familyName: string;
  lineWorksUrl: string | null;
};

/** ログイン中ユーザーから差出人情報を組み立てる（Employee が紐づいていれば社員名・lineWorksUrl を使う）。 */
export async function resolveSender(user: { id: string; name: string; email: string }): Promise<ContactMailSender> {
  const employee = await prisma.employee.findUnique({
    where: { userId: user.id },
    select: { name: true, lineWorksUrl: true },
  });
  const name = employee?.name?.trim() || user.name;
  return {
    userId: user.id,
    email: user.email,
    name,
    familyName: caFamilyNameOf(name),
    lineWorksUrl: employee?.lineWorksUrl?.trim() || null,
  };
}

/** From ヘッダ（`株式会社ビズスタジオ 〔CA姓〕 <ca@bizstudio.co.jp>`）。bizstudio.co.jp 以外は null（送れない）。 */
export function buildContactMailFrom(sender: ContactMailSender): string | null {
  return buildSenderFrom(sender.email, `株式会社ビズスタジオ ${sender.familyName}`.trim());
}

export type ContactMailBlock = { canSend: true } | { canSend: false; reason: string };

/** 送れない理由の判定（求職者アドレス・差出人ドメイン・LINE WORKS URL）。送らずに理由を返すためのもの。 */
export function checkCanSend(
  type: ContactMailType,
  candidate: { email: string | null },
  sender: ContactMailSender,
): ContactMailBlock {
  if (!candidate.email?.trim()) {
    return { canSend: false, reason: "求職者のメールアドレスが登録されていません" };
  }
  if (!buildContactMailFrom(sender)) {
    return {
      canSend: false,
      reason: "差出人にできるのは @bizstudio.co.jp のアカウントだけです（ログイン中のメールアドレスを確認してください）",
    };
  }
  if (requiresLineWorksUrl(type) && !sender.lineWorksUrl) {
    return { canSend: false, reason: "社員管理でLINE WORKSのURLを登録してください" };
  }
  return { canSend: true };
}

/** 種類ごとの最終送信日時（無ければ null）。 */
export async function findLastSentAt(candidateId: string): Promise<Record<ContactMailType, Date | null>> {
  const rows = await prisma.candidateContactMailLog.findMany({
    where: { candidateId },
    orderBy: { sentAt: "desc" },
    select: { type: true, sentAt: true },
  });
  const out: Record<ContactMailType, Date | null> = { line: null, greeting: null };
  for (const t of CONTACT_MAIL_TYPES) {
    const hit = rows.find((r) => r.type === CONTACT_MAIL_DB_TYPE[t]);
    out[t] = hit?.sentAt ?? null;
  }
  return out;
}

/** 確認画面用: 差し込み済みの件名・本文と（LINE のときは）QR の data: URL。 */
export async function buildContactMailPreview(
  type: ContactMailType,
  candidate: { name: string },
  sender: ContactMailSender,
) {
  const built = buildContactMail(type, {
    candidateName: candidate.name,
    caFamilyName: sender.familyName,
    lineWorksUrl: sender.lineWorksUrl,
  });
  const qrDataUrl = built.hasQr && sender.lineWorksUrl ? await buildQrDataUrl(sender.lineWorksUrl) : null;
  return { subject: built.subject, text: built.text, html: built.html, qrDataUrl };
}

export type SendContactMailResult =
  | { ok: true; logId: string; messageId: string | null; sentAt: Date }
  | { ok: false; error: string };

/**
 * 実送信＋記録。呼び出し側で checkCanSend と二重送信の判定を済ませてから呼ぶ。
 * From = CA本人（表示名「株式会社ビズスタジオ 〔CA姓〕」）、Reply-To = 同じアドレス、BCC = CA本人（控え）。
 * QR は PNG を cid 付きで添付し、HTML の <img src="cid:..."> で本文中に出す。
 */
export async function sendContactMail(
  type: ContactMailType,
  candidate: { id: string; name: string; email: string },
  sender: ContactMailSender,
): Promise<SendContactMailResult> {
  const from = buildContactMailFrom(sender);
  if (!from) return { ok: false, error: "差出人アドレスが bizstudio.co.jp ではありません" };

  const built = buildContactMail(type, {
    candidateName: candidate.name,
    caFamilyName: sender.familyName,
    lineWorksUrl: sender.lineWorksUrl,
  });

  const attachments =
    built.hasQr && sender.lineWorksUrl
      ? [
          {
            filename: "line-qr.png",
            content: (await buildQrPngBuffer(sender.lineWorksUrl)).toString("base64"),
            contentType: "image/png",
            contentId: LINE_QR_CID,
          },
        ]
      : undefined;

  const res = await sendResendEmail({
    to: candidate.email,
    bcc: [sender.email],
    subject: built.subject,
    text: built.text,
    html: built.html,
    from,
    replyTo: sender.email,
    attachments,
  });
  if (!res.ok) return { ok: false, error: res.error };

  const log = await prisma.candidateContactMailLog.create({
    data: {
      candidateId: candidate.id,
      type: CONTACT_MAIL_DB_TYPE[type],
      sentByUserId: sender.userId,
      toEmail: candidate.email,
      fromEmail: sender.email,
      subject: built.subject,
      messageId: res.messageId ?? null,
    },
    select: { id: true, sentAt: true },
  });
  return { ok: true, logId: log.id, messageId: res.messageId ?? null, sentAt: log.sentAt };
}
