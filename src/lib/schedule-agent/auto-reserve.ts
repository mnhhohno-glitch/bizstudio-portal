// T-194: 仮予約の中核処理（空き枠探索 → 二重予約チェック → 仮予約作成 → 予約後処理）。
//
// もともと /api/external/schedule-agent/resolve のモードA・モードB 共通部分として
// route.ts に直書きされていた処理を、そのままの順序・そのままの判定で切り出したもの。
// 呼び出し元は2つ:
//   (1) resolve（RPA経由の日程調整AI）… 従来どおり。deadline なし＝挙動は切り出し前と完全に同じ。
//   (2) create-schedule-task の autoReserve（フォーム送信時の自動仮確定）… deadline あり。
//
// 返信文面の生成（reply-templates.ts）はここには含めない。文面は resolve の責務のまま。
//
// この関数は throw しない前提で書かれている（内部の副作用はすべて try/catch 済み）が、
// 予期しない例外まで握りつぶすことはしない。呼び出し側の要求に応じて包むこと。
import { getReservationConfig, getTargetUserIds } from "./config";
import { findAvailableSlot, type DesiredWindow, type Slot } from "./match-slot";
import { brokenUserIds, probeCalendarConnections } from "./probe-connections";
import { sendBrokenCalendarAlert } from "./alert";
import { createReservation, fetchReservedEvents, findExistingReservation } from "./reserve";
import type { MeetingMethod } from "./reply-templates";
import { runPostReservation } from "./post-reserve";

export type AutoReserveInput = {
  candidateName: string;
  /** 面談登録・フォローアップタスクの紐付け用。無ければ null。 */
  candidateId: string | null;
  method: MeetingMethod;
  /** 希望日時（第1希望→第2希望…の順）。 */
  windows: DesiredWindow[];
  now: Date;
  mode: "task" | "message";
  taskId: string | null;
  /**
   * 枠探索・仮予約作成の打ち切り時刻（epoch ms）。省略時は無制限（＝resolve の従来挙動）。
   * 超過すると kind:"timeout" を返す。**仮予約の作成を開始した後は打ち切らない**
   * （カレンダーに書けたのに未反映、という状態を作らないため）。
   */
  deadline?: number;
};

export type AutoReserveResult =
  /** 仮予約が成立した（alreadyReserved=true は既存予約の再利用＝新規作成していない）。 */
  | { kind: "reserved"; slot: Slot; method: MeetingMethod; alreadyReserved: boolean }
  /** 範囲内の将来希望が無く、当日希望のみだった。 */
  | { kind: "today_only" }
  /** 範囲内の将来希望を全部見て空き無し／全希望が範囲外／対象CA0名。 */
  | { kind: "unavailable" }
  /** 時間上限で打ち切った（deadline 指定時のみ）。 */
  | { kind: "timeout" }
  /**
   * 何もできなかった（RPA経路では「返信不要」）。
   *   no_config           … 仮予約カレンダーの env 未設定（staging 等）
   *   calendar_unreadable … 仮予約カレンダーを読めなかった（権限/接続断）
   *   create_failed       … 仮予約イベントの書き込みに失敗
   */
  | { kind: "no_reply"; reason: "no_config" | "calendar_unreadable" | "create_failed" };

/**
 * 希望日時から仮予約を1件確保する。切り出し元（resolve のモードA/B共通部）と同じ判定・同じ順序。
 *
 * 枠のルールは match-slot.ts / jst.ts が単一ソース:
 *   60分枠・開始9:00〜20:00・当日不可・翌営業日〜2週間以内・土日祝不可・同一枠の多重仮予約上限あり。
 */
export async function autoReserveFromPreferences(input: AutoReserveInput): Promise<AutoReserveResult> {
  const { candidateName, candidateId, method, windows, now, mode, taskId, deadline } = input;

  // env 未設定なら枠取り・カレンダー登録を一切行わず安全終了（誤送信防止・Q5）
  const cfg = getReservationConfig();
  if (!cfg) return { kind: "no_reply", reason: "no_config" };

  const targets = getTargetUserIds();
  if (targets.length === 0) return { kind: "unavailable" };

  // ---- 連携状態プローブ＋アラート（T-167: fetchReservedEvents より前に実行する）----
  //   - 通知は完全に副作用: 失敗しても本処理は続行する（例外は内部で握りつぶす）。
  //   - 壊れた CA は枠探索の対象から明示除外し、「空き」と誤判定されるのを防ぐ。
  //   - writer が targets に含まれていない構成でも検知できるよう、writer を明示的にプローブ対象へ足す。
  const probeTargets = targets.includes(cfg.writerUserId) ? targets : [...targets, cfg.writerUserId];
  const probe = await probeCalendarConnections(probeTargets);
  const brokenAll = brokenUserIds(probe);
  const writerBroken = brokenAll.includes(cfg.writerUserId);
  if (brokenAll.length > 0) {
    try {
      await sendBrokenCalendarAlert(brokenAll, { writerBroken });
    } catch (e) {
      console.error("[auto-reserve] alert dispatch failed:", e);
    }
  }
  // 枠探索の除外対象は「空き判定の対象CA」のみ（writer は枠の持ち主ではない）
  const broken = brokenAll.filter((uid) => targets.includes(uid));

  if (deadline !== undefined && Date.now() > deadline) return { kind: "timeout" };

  // 仮予約カレンダーを1回だけ走査（二重予約チェック＋枠占有カウントの両方に使う）
  const reserved = await fetchReservedEvents(now);
  if (!reserved) return { kind: "no_reply", reason: "calendar_unreadable" }; // 読めない＝安全側

  // 二重予約防止: 同一氏名の未来の仮予約が既にあれば、新規登録しない
  const existing = findExistingReservation(reserved.events, candidateName, now);
  if (existing) {
    return { kind: "reserved", slot: existing.slot, method: existing.method, alreadyReserved: true };
  }

  if (deadline !== undefined && Date.now() > deadline) return { kind: "timeout" };

  // 枠探索（壊れたCAは除外）
  const outcome = await findAvailableSlot(windows, targets, reserved.events, now, broken, { deadline });
  if (outcome.kind === "today_only") return { kind: "today_only" };
  if (outcome.kind === "unavailable") return { kind: "unavailable" };
  if (outcome.kind === "timeout") return { kind: "timeout" };

  // 仮予約作成の直前が最後の打ち切り点。ここを越えたら完了まで走り切る。
  if (deadline !== undefined && Date.now() > deadline) return { kind: "timeout" };

  const eventId = await createReservation({
    candidateName,
    slot: outcome.slot,
    method,
    mode,
    taskId,
  });
  if (!eventId) return { kind: "no_reply", reason: "create_failed" }; // 書き込み失敗 → 誤送信しない

  // 新規仮予約成立時のみ後続処理（面談登録・LINE通知・翌朝タスク）を発火。
  //   - alreadyReserved=true（既存再利用）ではここに来ない＝二重作成しない。
  //   - runPostReservation は内部で失敗隔離し throw しない設計だが、防御的に try/catch で囲う。
  try {
    await runPostReservation({ candidateName, candidateId, slot: outcome.slot, method, mode, taskId });
  } catch (e) {
    console.error("[auto-reserve] post-reservation dispatch failed:", e);
  }

  return { kind: "reserved", slot: outcome.slot, method, alreadyReserved: false };
}
