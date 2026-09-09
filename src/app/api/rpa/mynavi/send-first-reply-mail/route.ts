import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { parseRpaRequestBody } from "@/lib/mynavi-rpa/parse-request-body";
import { sendResendEmail } from "@/lib/resend-mail";
import { buildMynaviFirstReplyMail } from "@/lib/mail-templates/mynavi-first-reply";

export const runtime = "nodejs";

const LOG = "[mynavi-first-reply-mail]";

/** 差出人。応募者からの返信を受けるため noreply ではなく agent@。VERIFIED_FROM_DOMAIN(@bizstudio.co.jp) 内。 */
const FROM = "株式会社ビズスタジオ <agent@bizstudio.co.jp>";

/**
 * testMode の宛先は固定（リクエストで宛先を指定させない＝APIキー漏えい時の踏み台化防止）。
 * 環境変数 RPA_MAIL_TEST_TO があればそれを優先する。
 */
const DEFAULT_TEST_TO = "masayuki_oono@bizstudio.co.jp";
function getTestTo(): string {
  const v = process.env.RPA_MAIL_TEST_TO?.trim();
  return v && v.length > 0 ? v : DEFAULT_TEST_TO;
}

type Result =
  | "SENT"
  | "ALREADY_SENT"
  | "NO_EMAIL"
  | "SEND_FAILED"
  | "NOT_FOUND"
  | "TEST_SENT"
  | "ERROR";

/**
 * レスポンスは全ケースで同じキー集合を返す（PAD はプロパティ欠落で例外停止するため）。値は null 可。
 */
type ResponseBody = {
  result: Result;
  candidateId: string | null;
  candidateName: string | null;
  hasEmail: boolean;
  emailMasked: string | null;
  sentAt: string | null;
  messageId: string | null;
  message: string;
};

function respond(partial: Partial<ResponseBody> & { result: Result; message: string }) {
  const body: ResponseBody = {
    result: partial.result,
    candidateId: partial.candidateId ?? null,
    candidateName: partial.candidateName ?? null,
    hasEmail: partial.hasEmail ?? false,
    emailMasked: partial.emailMasked ?? null,
    sentAt: partial.sentAt ?? null,
    messageId: partial.messageId ?? null,
    message: partial.message,
  };
  console.log(
    `${LOG} candidateId=${body.candidateId ?? "(none)"} result=${body.result} ${body.message}`,
  );
  // 認証失敗以外は常に 200（RPA が失敗時に処理全体をやり直し、マイナビ側の一次返信が二重送信されるのを防ぐ）。
  return NextResponse.json(body, { status: 200 });
}

/** PAD は boolean を "true"/"True"/"1" の文字列で送ることがあるため緩く解釈する。 */
function parseBool(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  }
  if (typeof v === "number") return v === 1;
  return false;
}

/** ya***@example.com 形式。ローカル部が短いときは先頭1文字。 */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const keep = local.length >= 3 ? 2 : 1;
  return `${local.slice(0, keep)}***${domain}`;
}

/**
 * JST(+09:00) 表記の ISO 文字列（例 2026-09-10T20:15:00+09:00）。
 * 罠#17: toISOString().slice() 系は使わず timeZone:'Asia/Tokyo' で組む（JST は DST 無しで常に +09:00）。
 */
function toJstIso(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "00";
  // hour は "24" が返る実装があるため 00 に丸める
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}+09:00`;
}

/**
 * POST /api/rpa/mynavi/send-first-reply-mail
 * T-193: マイナビ一次返信と同内容の案内メールを portal から Resend で送る。
 *
 * - 認証失敗(401)以外は常に 200 を返し、状態は result で表現する。
 * - 二重送信防止は「先に予約してから送る」: updateMany(where sentAt IS NULL) で押さえた側だけが送信する。
 * - 送信失敗時のロールバックは Resend が明確に拒否（非2xx）したときのみ。通信エラー・タイムアウトは
 *   「送られたか分からない」ので予約を残す（応募者への二重送信を避ける方を優先）。
 * - testMode: 固定宛先へ本番と同一内容を送るだけ。予約・記録は一切しない。
 */
export async function POST(req: Request) {
  if (!verifyRpaSecret(req)) {
    console.warn(`${LOG} unauthorized`);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let candidateId: string | null = null;
  try {
    const body = await parseRpaRequestBody(req);
    candidateId = body?.candidateId ? String(body.candidateId).trim() : "";
    const testMode = parseBool(body?.testMode);

    if (!candidateId) {
      return respond({ result: "NOT_FOUND", message: "candidateId が指定されていません" });
    }

    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: {
        id: true,
        name: true,
        email: true,
        mynaviFirstReplyMailSentAt: true,
        mynaviFirstReplyMailMessageId: true,
      },
    });
    if (!candidate) {
      return respond({ result: "NOT_FOUND", candidateId, message: "求職者が見つかりません" });
    }

    const candidateName = candidate.name.trim();
    const email = candidate.email?.trim() || "";
    const hasEmail = email.length > 0;
    const emailMasked = hasEmail ? maskEmail(email) : null;
    const base = { candidateId, candidateName, hasEmail, emailMasked };

    const mail = buildMynaviFirstReplyMail({ name: candidateName, candidateId });

    // ---- testMode: 固定宛先へ送るだけ。予約も記録もしない ----
    if (testMode) {
      const to = getTestTo();
      const r = await sendResendEmail({ from: FROM, to, subject: mail.subject, text: mail.text });
      if (r.ok) {
        return respond({
          ...base,
          result: "TEST_SENT",
          sentAt: toJstIso(new Date()),
          messageId: r.messageId ?? null,
          message: `テスト送信しました（宛先: ${to}）`,
        });
      }
      return respond({ ...base, result: "SEND_FAILED", message: `テスト送信に失敗しました: ${r.error}` });
    }

    // ---- 本送信 ----
    if (candidate.mynaviFirstReplyMailSentAt) {
      return respond({
        ...base,
        result: "ALREADY_SENT",
        sentAt: toJstIso(candidate.mynaviFirstReplyMailSentAt),
        messageId: candidate.mynaviFirstReplyMailMessageId ?? null,
        message: "既に送信済みです",
      });
    }
    if (!hasEmail) {
      return respond({ ...base, result: "NO_EMAIL", message: "メールアドレスが未登録のため送信していません" });
    }

    // 1) 条件付き予約（sentAt が null の行だけを押さえる）
    const reservedAt = new Date();
    const reserved = await prisma.candidate.updateMany({
      where: { id: candidateId, mynaviFirstReplyMailSentAt: null },
      data: { mynaviFirstReplyMailSentAt: reservedAt },
    });

    // 2) 押さえられなかった＝他の呼び出しが先に送っている
    if (reserved.count === 0) {
      const cur = await prisma.candidate.findUnique({
        where: { id: candidateId },
        select: { mynaviFirstReplyMailSentAt: true, mynaviFirstReplyMailMessageId: true },
      });
      return respond({
        ...base,
        result: "ALREADY_SENT",
        sentAt: cur?.mynaviFirstReplyMailSentAt ? toJstIso(cur.mynaviFirstReplyMailSentAt) : null,
        messageId: cur?.mynaviFirstReplyMailMessageId ?? null,
        message: "既に送信済みです（同時実行）",
      });
    }

    // 3) 予約を取れた側だけが送信する
    const r = await sendResendEmail({ from: FROM, to: email, subject: mail.subject, text: mail.text });

    if (r.ok) {
      // 4) 成功: messageId を記録
      const messageId = r.messageId ?? null;
      await prisma.candidate.update({
        where: { id: candidateId },
        data: { mynaviFirstReplyMailMessageId: messageId },
      });
      return respond({
        ...base,
        result: "SENT",
        sentAt: toJstIso(reservedAt),
        messageId,
        message: "送信しました",
      });
    }

    // 5) 失敗: Resend が明確に拒否した場合のみ予約を戻す。通信エラー等は「送られたか分からない」ので残す。
    if (r.rejected === true) {
      await prisma.candidate.updateMany({
        where: { id: candidateId, mynaviFirstReplyMailSentAt: reservedAt },
        data: { mynaviFirstReplyMailSentAt: null },
      });
      return respond({ ...base, result: "SEND_FAILED", message: `送信に失敗しました（Resend 拒否・予約解除）: ${r.error}` });
    }
    return respond({
      ...base,
      result: "SEND_FAILED",
      sentAt: toJstIso(reservedAt),
      message: `送信に失敗しました（結果不明のため予約は保持）: ${r.error}`,
    });
  } catch (e) {
    console.error(`${LOG} candidateId=${candidateId ?? "(none)"} unexpected error:`, e);
    const detail = e instanceof Error ? e.message : String(e);
    return respond({ result: "ERROR", candidateId, message: `予期しないエラー: ${detail}` });
  }
}
