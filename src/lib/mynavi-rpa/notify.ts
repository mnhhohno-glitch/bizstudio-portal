import { sendBotMessage } from "@/lib/lineworks";
import { prisma } from "@/lib/prisma";
import type { RpaExecutionBatch } from "@prisma/client";

/**
 * マイナビRPA新フロー専用 LINE WORKS 通知
 * トークルーム「マイナビ転職応募取り込み」へ送信する。
 */

function getMynaviChannel(): { botId: string; channelId: string } | null {
  const botId = process.env.LINEWORKS_MYNAVI_BOT_ID;
  const channelId = process.env.LINEWORKS_MYNAVI_CHANNEL_ID;
  if (!botId || !channelId) {
    console.warn("[mynavi-rpa/notify] LINEWORKS_MYNAVI_* が未設定のため通知をスキップ");
    return null;
  }
  return { botId, channelId };
}

function formatJst(date: Date): string {
  return date.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatJstTime(date: Date): string {
  return date.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 応募者行用の JST 日時整形（"yyyy/m/d HH:mm" 形式）。
 * Railway は UTC 稼働のため Asia/Tokyo を明示し、月日はゼロ埋めしない numeric。
 */
function formatApplyDateTime(date: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * バッチ完了通知
 */
export async function notifyMynaviBatchCompletion(
  batch: RpaExecutionBatch,
): Promise<void> {
  const ch = getMynaviChannel();
  if (!ch) return;

  try {
    const baseUrl = process.env.PORTAL_BASE_URL || "";
    const start = batch.startedAt;
    const end = batch.finishedAt ?? new Date();
    const durationMin = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 60000),
    );

    const timeRange = `${formatJst(start)}-${formatJstTime(end)} (${durationMin}分)`;

    // 処理対象（処理件数に数えた全員）を 1 人 1 行で表示する。
    // 表示日時は本来「マイナビ応募日時」を使いたいが、現状その値は
    // データパイプライン上のどこにも取り込まれていない（Gemini 解析対象外、
    // mynaviScoutSentAt も未書き込み）。そのため取り込み処理日時 processedAt に
    // フォールバックし、processedAt 昇順（取り込み順 ≒ 応募順）で並べる。
    const logs = await prisma.mynaviRpaProcessingLog.findMany({
      where: { batchId: batch.id },
      select: { candidateName: true, processedAt: true },
      orderBy: { processedAt: "asc" },
    });
    const applicantLines = logs.map((l) => {
      const name = l.candidateName?.trim() || "（氏名不明）";
      return `${formatApplyDateTime(l.processedAt)} ${name}`;
    });

    const message = [
      "📊 マイナビ転職応募取り込み 完了",
      ...applicantLines,
      `処理時刻: ${timeRange}`,
      `処理件数: ${batch.totalCount}件`,
      `　通常送信: ${batch.normalCount}件`,
      `　年齢NG: ${batch.ageNgCount}件`,
      `　外国籍NG: ${batch.foreignNgCount}件`,
      `　AI解析失敗: ${batch.aiFailedCount}件`,
      `　二重処理スキップ: ${batch.duplicateSkipCount}件`,
      `　エラー: ${batch.errorCount}件`,
      `詳細: ${baseUrl}/rpa-error/executions/${batch.id}`,
    ].join("\n");

    await sendBotMessage(ch.botId, ch.channelId, message);
  } catch (e) {
    console.error("[mynavi-rpa/notify] バッチ完了通知失敗:", e);
  }
}

/**
 * 二重処理検知通知
 */
export async function notifyMynaviDuplicateSkip(
  phoneNormalized: string,
  candidateName?: string,
): Promise<void> {
  const ch = getMynaviChannel();
  if (!ch) return;

  try {
    const namePart = candidateName ? `（${candidateName}）` : "";
    const message = [
      "⚠️ マイナビ転職応募取り込み 二重処理検知",
      `電話番号 ${phoneNormalized}${namePart} が直近30分以内に処理済みです。スキップしました。`,
    ].join("\n");

    await sendBotMessage(ch.botId, ch.channelId, message);
  } catch (e) {
    console.error("[mynavi-rpa/notify] 二重処理検知通知失敗:", e);
  }
}

/**
 * エラー通知
 */
export async function notifyMynaviError(
  message: string,
  context?: object,
): Promise<void> {
  const ch = getMynaviChannel();
  if (!ch) return;

  try {
    const lines = ["🚨 マイナビ転職応募取り込み エラー", message];
    if (context && Object.keys(context).length > 0) {
      lines.push(JSON.stringify(context));
    }
    await sendBotMessage(ch.botId, ch.channelId, lines.join("\n"));
  } catch (e) {
    console.error("[mynavi-rpa/notify] エラー通知失敗:", e);
  }
}
