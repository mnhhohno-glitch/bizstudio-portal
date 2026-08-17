/**
 * T-159 Phase 2-c: OneDrive 夜間拾い直しの結果を LINE WORKS へ流す。
 *
 * 宛先は既存の CA 通知チャンネル（LINEWORKS_TASK_BOT_ID / LINEWORKS_TASK_CHANNEL_ID）。
 * 応募通知・タスク通知と同じ経路で、CA が普段見ている場所に出す。
 *
 * ★文面に技術用語を出さない。読み手は CA であり、status や skipReason という語彙を持たない。
 *   「NO_SUBFOLDER が 3件」ではなく「OneDrive に「2.求人」フォルダがありません: 3名」と書く。
 *
 * ★氏名・求職者番号は載せない（確定仕様）。LINE WORKS のメッセージは端末に残り転送もできるため、
 *   個人が特定できる情報は置かず件数だけにする。誰なのかは portal の画面で見てもらう。
 *
 * ★対応が必要なものが1件も無ければ送らない。毎晩「0件」が流れると読まれなくなり、
 *   本当に対応が必要な晩の通知も一緒に無視されるため。
 */

import { OneDriveSyncSkipReason } from "@prisma/client";
import { sendBotMessage } from "@/lib/lineworks";
import type { OneDriveSyncRetrySummary } from "@/lib/onedrive-sync-retry";

/** 通知の送信結果。呼び出し元（API）がレスポンスに載せて GitHub Actions のログから追えるようにする。 */
export type OneDriveNotifyResult =
  | "SENT"
  | "SKIPPED_NO_ACTION" // 対応が必要なものが無い（正常。送らないのが仕様）
  | "SKIPPED_NO_CONFIG" // LINEWORKS_TASK_* 未設定
  | "SKIPPED_DRY_RUN"
  | "FAILED";

/**
 * 理由 → CA 向けの日本語。`{folders}` は不足していたサブフォルダ名に差し替える。
 * 「何をすればよいか」が read の1行で分かる語順にしてある。
 */
function reasonLabel(reason: OneDriveSyncSkipReason, missingSubfolders: string[]): string {
  switch (reason) {
    case OneDriveSyncSkipReason.NO_SUBFOLDER: {
      const names =
        missingSubfolders.length > 0
          ? missingSubfolders.map((n) => `「${n}」`).join("・")
          : "「2.求人」「3.BS作成書類」";
      return `OneDriveに${names}フォルダが無い`;
    }
    case OneDriveSyncSkipReason.NO_FOLDER_URL:
      return "OneDriveフォルダのURLが未登録";
    case OneDriveSyncSkipReason.BAD_FOLDER_URL:
      return "OneDriveフォルダのURLが正しくない";
    default:
      return String(reason);
  }
}

/** JST の月/日。夜間処理は JST 02:00 に走るので、CA の感覚では「その日の深夜分」。 */
function jstMonthDay(at: Date): string {
  return at.toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
  });
}

/**
 * 通知文を組む。対応が必要なものが1件も無ければ null（＝送らない）。
 *
 * 「諦めた件数（GIVEN_UP）」も対応が必要なものとして扱う。何度試しても入らなかったので、
 * 以後 portal は自動では試さない＝誰かが手で入れる必要がある、という意味だから。
 */
export function buildOneDriveSyncNotification(
  summary: OneDriveSyncRetrySummary,
  at: Date = new Date(),
): string | null {
  const actionLines = summary.needsAttention
    .filter((b) => b.candidates > 0)
    .map((b) => `・${reasonLabel(b.reason, summary.missingSubfolders)}: ${b.candidates}名`);

  if (summary.givenUp > 0) {
    actionLines.push(`・何度試してもコピーできなかった書類: ${summary.givenUp}件`);
  }

  if (actionLines.length === 0) return null;

  return [
    `OneDriveへの書類コピー（${jstMonthDay(at)} 深夜分）`,
    "",
    `コピー完了: ${summary.success}件`,
    "",
    "以下は対応が必要です",
    ...actionLines,
    "詳細はポータルの求職者画面をご確認ください",
  ].join("\n");
}

/** 通知を送る。送信の失敗で夜間処理そのものを失敗扱いにしないよう、例外は投げず結果を返す。 */
export async function notifyOneDriveSyncResult(
  summary: OneDriveSyncRetrySummary,
  at: Date = new Date(),
): Promise<{ result: OneDriveNotifyResult; message: string | null }> {
  const message = buildOneDriveSyncNotification(summary, at);
  if (!message) return { result: "SKIPPED_NO_ACTION", message: null };

  const botId = process.env.LINEWORKS_TASK_BOT_ID;
  const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
  if (!botId || !channelId) {
    console.warn("[onedrive-sync-notify] LINEWORKS_TASK_* が未設定のため通知をスキップ");
    return { result: "SKIPPED_NO_CONFIG", message };
  }

  try {
    await sendBotMessage(botId, channelId, message);
    return { result: "SENT", message };
  } catch (e) {
    console.error("[onedrive-sync-notify] 通知の送信に失敗:", e);
    return { result: "FAILED", message };
  }
}
