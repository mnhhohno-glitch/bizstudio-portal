import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { notifyMynaviError } from "@/lib/mynavi-rpa/notify";

export const runtime = "nodejs";

const TEMPLATE_NAME = "【日程調整】初回メッセージ";
const SENDER_NAME = "藤本 夏海";

/**
 * POST /api/rpa/mynavi/reply-sent
 * RPA が一次返信を送信した後の完了通知。処理ログを更新し設定履歴を追加する。
 */
export async function POST(req: Request) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const processingLogId: string = String(body?.processingLogId || "");
    const sendResult: string =
      body?.sendResult === "FAILURE" ? "FAILURE" : "SUCCESS";
    const sentAt: Date = body?.sentAt ? new Date(body.sentAt) : new Date();

    if (!processingLogId) {
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

    const candidateId: string | null = body?.candidateId
      ? String(body.candidateId)
      : log.candidateId;

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
