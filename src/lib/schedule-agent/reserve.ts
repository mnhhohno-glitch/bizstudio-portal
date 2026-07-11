// T-139 step3: 日程調整AIエージェント 共通コア（仮予約カレンダー書き込み）。
//
// 書き込み先は共有カレンダー「仮予約」（env SCHEDULE_RESERVATION_CALENDAR_ID）。
// 名義は Q4 の書き込みユーザー（env SCHEDULE_RESERVATION_WRITER_USER_ID＝大野将幸）で、
// そのユーザーの OAuth 資格情報を使って共有カレンダーへ insert する。
//
// 仮予約は「確定記録」ではなく、翌営業日に人が最終割り当てするまでの仮置き場。
// AI は作成のみ行い、削除・更新はしない（人が手動で捌く運用）。
import { createCalendarEvent } from "@/lib/googleCalendar";
import type { MatchedSlot } from "./match-slot";

const DAYS_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** env 2本が揃っているときだけ設定済み。未設定なら呼び出し側は skipped で安全終了する。 */
export function getReservationConfig(): { calendarId: string; writerUserId: string } | null {
  const calendarId = process.env.SCHEDULE_RESERVATION_CALENDAR_ID?.trim();
  const writerUserId = process.env.SCHEDULE_RESERVATION_WRITER_USER_ID?.trim();
  if (!calendarId || !writerUserId) return null;
  return { calendarId, writerUserId };
}

/** "2026-07-15" + "11:00"〜"12:00" → "2026年7月15日（水） 11:00〜12:00" */
export function formatSlotJa(slot: Pick<MatchedSlot, "date" | "startTime" | "endTime">): string {
  const [y, m, d] = slot.date.split("-").map(Number);
  const dow = DAYS_JA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}年${m}月${d}日（${dow}） ${slot.startTime}〜${slot.endTime}`;
}

export type ReservationInput = {
  candidateName: string;
  slot: MatchedSlot;
  meetingFormat?: string | null;
  /** 夜間バッチ経由なら元タスクID。外部受け口経由は null。 */
  taskId?: string | null;
};

export type ReservationResult =
  | { ok: true; eventId: string; when: string }
  | { ok: false; reason: string };

/** 仮予約イベントを共有カレンダーに1件作成する。 */
export async function createReservation(input: ReservationInput): Promise<ReservationResult> {
  const cfg = getReservationConfig();
  if (!cfg) return { ok: false, reason: "reservation calendar not configured" };

  const { slot, candidateName } = input;
  const when = formatSlotJa(slot);

  const summary = `【仮予約】${candidateName} / 担当候補:${slot.userName} / ${slot.desired.label}（AI仮確定）`;

  const description = [
    `応募者名: ${candidateName}`,
    `面談形式: ${input.meetingFormat?.trim() || "未指定"}`,
    `担当候補CA: ${slot.userName}`,
    `採用した希望: ${slot.desired.label}（${when}）`,
    `元タスクID: ${input.taskId ?? "（外部受け口・タスクなし）"}`,
    "",
    "※日程調整AIによる仮予約です。確定ではありません。",
    "※翌営業日に担当者が最終割り当てを行い、本イベントは手動で削除してください。",
  ].join("\n");

  const eventId = await createCalendarEvent(
    cfg.writerUserId,
    slot.date,
    { summary, startTime: slot.startTime, endTime: slot.endTime, description },
    cfg.calendarId // 共有「仮予約」カレンダーへ明示的に書く（既定の primary ではない）
  );

  if (!eventId) return { ok: false, reason: "calendar write failed" };
  return { ok: true, eventId, when };
}
