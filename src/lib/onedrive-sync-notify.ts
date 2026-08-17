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
import type { OneDriveFolderUrlSyncSummary } from "@/lib/onedrive-folder-url-sync";
import {
  type GraphSecretExpiryEvaluation,
  buildGraphSecretExpiryNotification,
} from "@/lib/onedrive-graph-secret";

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

// ============================================================
// T-159 Phase 3: 夜間処理まるごと1通にまとめる
// ============================================================

/**
 * 夜間処理の全フェーズをまとめた通知の入力。
 *
 * ★1通にまとめる。フェーズごとに送ると同じ深夜に3通並び、どれが本題か分からなくなる。
 */
export interface OneDriveNightlyNotifyInput {
  /** 既存の拾い直し（フェーズ3）の結果。 */
  retry: OneDriveSyncRetrySummary;
  /** 機能1・機能2（フェーズ1・2）の結果。実行しなかった場合は null。 */
  folderUrl: OneDriveFolderUrlSyncSummary | null;
  /** 機能3（鍵の期限）の評価。 */
  secret: GraphSecretExpiryEvaluation | null;
}

/**
 * 「自動で片付いたこと」の行。0件の項目は出さない。
 *
 * ★これは good news だが黙らない。CA から見ると「昨日まで出ていた対応依頼が消えた」理由が
 *   分からないため、URLが自動で付いたことは伝える必要がある。
 */
function autoActionLines(folderUrl: OneDriveFolderUrlSyncSummary | null): string[] {
  if (!folderUrl) return [];
  const lines: string[] = [];
  if (folderUrl.register.registered > 0) {
    lines.push(`・OneDriveフォルダの場所を自動で登録しました: ${folderUrl.register.registered}名`);
  }
  if (folderUrl.move.updated > 0) {
    lines.push(
      `・フォルダの移動に合わせてリンクを付け替えました: ${folderUrl.move.updated}名`,
    );
  }
  return lines;
}

/** 人間の判断が必要な行（安全弁の作動・走査の異常）。 */
function autoWarningLines(folderUrl: OneDriveFolderUrlSyncSummary | null): string[] {
  if (!folderUrl) return [];
  const lines: string[] = [];
  if (folderUrl.abortedReason) {
    lines.push("・OneDriveフォルダの自動確認ができませんでした（設定の確認が必要です）");
    return lines;
  }
  if (folderUrl.move.blocked === "TOO_MANY_UPDATES") {
    lines.push(
      `・リンクの付け替えが一度に多すぎるため保留しました: ${folderUrl.move.planned}名` +
        `（上限 ${folderUrl.move.maxUpdates}名）`,
    );
  }
  if (folderUrl.move.blocked === "SCAN_UNTRUSTWORTHY" || folderUrl.scan?.trustworthy === false) {
    lines.push("・OneDriveのフォルダ一覧が想定より少ないため、リンクの確認を見送りました");
  }
  return lines;
}

/**
 * 夜間処理1回ぶんの通知文。出すものが何も無ければ null（＝送らない）。
 *
 * 送る条件は「CA か運用者が読んで何かが変わること」がある晩だけ:
 *   - 対応が必要なものがある（既存の判定）
 *   - 自動で登録・付け替えが起きた
 *   - 安全弁が作動した
 *   - 鍵の期限が節目に来た／切れている
 */
export function buildOneDriveNightlyNotification(
  input: OneDriveNightlyNotifyInput,
  at: Date = new Date(),
): string | null {
  const blocks: string[] = [];

  const retryBlock = buildOneDriveSyncNotification(input.retry, at);
  const autoLines = autoActionLines(input.folderUrl);
  const warnLines = autoWarningLines(input.folderUrl);

  if (retryBlock) {
    blocks.push(retryBlock);
  } else if (autoLines.length > 0 || warnLines.length > 0) {
    // 対応依頼が無い晩でも、自動で動いたことだけは日付つきで伝える。
    blocks.push(
      [
        `OneDriveへの書類コピー（${jstMonthDay(at)} 深夜分）`,
        "",
        `コピー完了: ${input.retry.success}件`,
      ].join("\n"),
    );
  }

  if (autoLines.length > 0) {
    blocks.push(["自動で対応したこと", ...autoLines].join("\n"));
  }
  if (warnLines.length > 0) {
    blocks.push(["確認が必要です", ...warnLines].join("\n"));
  }

  const secretBlock = input.secret ? buildGraphSecretExpiryNotification(input.secret) : null;
  if (secretBlock) blocks.push(secretBlock);

  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

/** 夜間処理まるごとの結果を1通送る。例外は投げず結果を返す。 */
export async function notifyOneDriveNightlyResult(
  input: OneDriveNightlyNotifyInput,
  at: Date = new Date(),
): Promise<{ result: OneDriveNotifyResult; message: string | null }> {
  return sendIfPossible(buildOneDriveNightlyNotification(input, at));
}

/** 通知を送る。送信の失敗で夜間処理そのものを失敗扱いにしないよう、例外は投げず結果を返す。 */
export async function notifyOneDriveSyncResult(
  summary: OneDriveSyncRetrySummary,
  at: Date = new Date(),
): Promise<{ result: OneDriveNotifyResult; message: string | null }> {
  return sendIfPossible(buildOneDriveSyncNotification(summary, at));
}

async function sendIfPossible(
  message: string | null,
): Promise<{ result: OneDriveNotifyResult; message: string | null }> {
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
