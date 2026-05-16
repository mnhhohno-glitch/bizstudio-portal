import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { notifyMynaviError } from "@/lib/mynavi-rpa/notify";
import { parseRpaRequestBody } from "@/lib/mynavi-rpa/parse-request-body";

export const runtime = "nodejs";

const TEMPLATE_NAME = "【日程調整】初回メッセージ";
const SENDER_NAME = "藤本 夏海";

function parseDateLoose(value: unknown): Date {
  if (!value) return new Date();
  const s = String(value).trim();
  if (!s) return new Date();
  const slashMatch = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (slashMatch) {
    const [, y, mo, d, h, mi, sec] = slashMatch;
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec));
  }
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * POST /api/rpa/mynavi/reply-sent
 * RPA が一次返信を送信した後の完了通知。処理ログを更新し設定履歴を追加する。
 */
export async function POST(req: Request) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await parseRpaRequestBody(req);

    const processingLogId: string = String(body?.processingLogId || "");
    const sendResult: string =
      body?.sendResult === "FAILURE" ? "FAILURE" : "SUCCESS";
    const sentAt: Date = parseDateLoose(body?.sentAt);

    if (!processingLogId) {
      console.error("[rpa/mynavi/reply-sent] processingLogId missing. body:", JSON.stringify(body));
      return NextResponse.json(
        { error: "processingLogId は必須です" },
        { status: 400 },
      );
    }

    const log = await prisma.mynaviRpaProcessingLog.findUnique({
      where: { id: processingLogId },
      select: { id: true, candidateId: true },
    });
    if (!log) {
      return NextResponse.json(
        { error: "指定された処理ログが見つかりません" },
        { status: 404 },
      );
    }

    const candidateId: string | null =
      (body?.candidateId ? String(body.candidateId) : null) || log.candidateId;

    await prisma.mynaviRpaProcessingLog.update({
      where: { id: processingLogId },
      data: { replySentAt: sentAt, replyResult: sendResult },
    });

    if (candidateId) {
      const candidate = await prisma.candidate.findUnique({
        where: { id: candidateId },
        select: { id: true },
      });
      if (candidate) {
        await prisma.candidateSettingsHistory.create({
          data: {
            candidateId,
            sentAt,
            sendType: "MYNAVI_FIRST_REPLY",
            sendResult,
            templateName: TEMPLATE_NAME,
            senderName: SENDER_NAME,
          },
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[rpa/mynavi/reply-sent] error:", e);
    const message = e instanceof Error ? e.message : String(e);
    await notifyMynaviError(`一次返信完了通知の処理に失敗しました`, { detail: message });
    return NextResponse.json(
      { error: `予期しないエラー: ${message}` },
      { status: 500 },
    );
  }
}
