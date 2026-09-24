// T-196 step1: POST /api/rpa/mynavi/schedule-reply/complete
// 7号機RPA が「マイナビで送った／送れなかった」を報告してくる受け口。
//
// result は success / failed / unconfirmed の3つ。
//   unconfirmed = マイナビで「送信する」は押したが「送信しました」を確認できなかった。
//   実際には送れていることが多いので **自動再送はしない**。打刻して pending から外し、人に目視確認を頼む。
//
// 認証: x-rpa-secret（既存 /api/rpa/mynavi/* と同じ verifyRpaSecret）。
// 二重送信防止は T-193 と同じ「先に押さえる」方式:
//   updateMany(where: { id, mynaviReplySentAt: null }) で1行取れた側だけが送信済みとして確定する。
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { parseRpaRequestBody } from "@/lib/mynavi-rpa/parse-request-body";
import { resolveSystemUserId, toJstIso } from "@/lib/schedule-tasks";
import {
  MYNAVI_REPLY_FAILED_PREFIX,
  MYNAVI_REPLY_SENT_COMMENT,
  MYNAVI_REPLY_UNCONFIRMED_PREFIX,
  notifyMynaviReplyUnconfirmed,
} from "@/lib/schedule-agent/mynavi-reply";
import { extractCandidateName } from "@/lib/schedule-agent/parse-preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG = "[mynavi-schedule-reply/complete]";

/** コメント追加はベストエフォート。ここでの失敗が送信済み確定を巻き戻してはいけない。 */
async function addComment(taskId: string, content: string): Promise<void> {
  try {
    const systemUserId = await resolveSystemUserId();
    if (!systemUserId) {
      console.error(`${LOG} コメント作者を解決できません task=${taskId}`);
      return;
    }
    await prisma.taskComment.create({ data: { taskId, userId: systemUserId, content } });
  } catch (e) {
    console.error(`${LOG} コメント追加に失敗 task=${taskId}:`, e);
  }
}

export async function POST(req: Request) {
  if (!verifyRpaSecret(req)) {
    console.warn(`${LOG} unauthorized`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await parseRpaRequestBody(req);
  const taskId = body?.taskId ? String(body.taskId).trim() : "";
  const result = body?.result ? String(body.result).trim() : "";
  const note = body?.note != null ? String(body.note).trim() : "";

  if (!taskId) {
    return NextResponse.json({ error: "taskId は必須です" }, { status: 400 });
  }
  if (result !== "success" && result !== "failed" && result !== "unconfirmed") {
    return NextResponse.json(
      { error: 'result は "success" / "failed" / "unconfirmed" のいずれかを指定してください' },
      { status: 400 },
    );
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      mynaviReplySentAt: true,
      mynaviReplyMemberNo: true,
      candidate: { select: { name: true } },
    },
  });
  if (!task) {
    return NextResponse.json({ error: "タスクが見つかりません" }, { status: 404 });
  }

  if (result === "unconfirmed") {
    const detail = note || "（状況の報告なし）";
    // 送信打刻はしない（送れたか分からないため）。要目視確認だけを掴む。
    // 掴めた側だけがコメントと通知を出す＝同じ報告が2回来ても人を二度呼ばない。
    const reserved = await prisma.task.updateMany({
      where: { id: taskId, mynaviReplySentAt: null, mynaviReplyUnconfirmedAt: null },
      data: { mynaviReplyUnconfirmedAt: new Date() },
    });
    if (reserved.count === 0) {
      console.log(`${LOG} task=${taskId} unconfirmed (already recorded)`);
      return NextResponse.json({ ok: true, status: "unconfirmed" });
    }

    await addComment(taskId, `${MYNAVI_REPLY_UNCONFIRMED_PREFIX}: ${detail}`);
    // 通知の失敗で受け口を落とさない（notifyMynaviReplyUnconfirmed は throw しない）。
    const notified = await notifyMynaviReplyUnconfirmed({
      taskId,
      candidateName: task.candidate?.name ?? extractCandidateName(task.title) ?? "",
      memberNo: task.mynaviReplyMemberNo ?? "",
    });
    console.log(`${LOG} task=${taskId} unconfirmed notified=${notified} note=${detail}`);
    return NextResponse.json({ ok: true, status: "unconfirmed" });
  }

  if (result === "failed") {
    const detail = note || "（理由の報告なし）";
    await addComment(taskId, `${MYNAVI_REPLY_FAILED_PREFIX}: ${detail}`);
    console.log(`${LOG} task=${taskId} failed note=${detail}`);
    // 送信済み打刻はしない＝次回の pending にまた出る（3回失敗で自動的に外れる）。
    return NextResponse.json({ ok: true, alreadySent: false, sentAt: null });
  }

  // ---- success: 先に押さえてから記録する ----
  const sentAt = new Date();
  const reserved = await prisma.task.updateMany({
    where: { id: taskId, mynaviReplySentAt: null },
    data: { mynaviReplySentAt: sentAt },
  });

  if (reserved.count === 0) {
    const cur = await prisma.task.findUnique({
      where: { id: taskId },
      select: { mynaviReplySentAt: true },
    });
    console.log(`${LOG} task=${taskId} already sent`);
    return NextResponse.json({
      ok: true,
      alreadySent: true,
      sentAt: cur?.mynaviReplySentAt ? toJstIso(cur.mynaviReplySentAt) : null,
    });
  }

  await addComment(taskId, MYNAVI_REPLY_SENT_COMMENT);
  console.log(`${LOG} task=${taskId} sent`);
  return NextResponse.json({ ok: true, alreadySent: false, sentAt: toJstIso(sentAt) });
}
