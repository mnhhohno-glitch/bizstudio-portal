// T-139 step4: 仮予約カレンダーの読み取り／二重予約チェック／登録。
//
// 書き込み先は共有カレンダー「仮予約」（env SCHEDULE_RESERVATION_CALENDAR_ID）。
// 名義は env SCHEDULE_RESERVATION_WRITER_USER_ID のユーザーのOAuth資格情報。
// 仮予約は翌朝人間が振り分けるまでの仮置き場。**AIは作成のみ・削除も更新もしない**。
//
// イベントタイトル: `{氏名} {M/D(曜)HH:MM-HH:MM} {面談方法}`
//   例: `山田太郎 7/15(火)19:00-20:00 電話`
import { createCalendarEvent, listCalendarEventsRange } from "@/lib/googleCalendar";
import { getReservationConfig } from "./config";
import type { ReservedEvent, Slot } from "./match-slot";
import type { MeetingMethod } from "./reply-templates";
import { HORIZON_DAYS, addDaysYmd, eventTitleWhen, jstYmd, jstIso, toMin } from "./jst";

/** 仮予約カレンダーの走査範囲: 今日〜(2週間+1日)。二重予約チェックと枠占有カウントの両方に使う。 */
export async function fetchReservedEvents(
  now: Date
): Promise<{ events: ReservedEvent[]; raw: { summary: string; startISO: string }[] } | null> {
  const cfg = getReservationConfig();
  if (!cfg) return null;

  const today = jstYmd(now);
  const from = jstIso(today, "00:00");
  const to = jstIso(addDaysYmd(today, HORIZON_DAYS + 1), "00:00");

  const items = await listCalendarEventsRange(cfg.writerUserId, from, to, cfg.calendarId);
  if (items === null) return null; // 読めなかった（権限/接続断）＝呼び出し側で安全側に倒す

  const events: ReservedEvent[] = items.map((e) => {
    const d = new Date(e.startISO);
    const endD = new Date(e.endISO);
    const date = jstYmd(d);
    const hhmm = (x: Date) =>
      x.toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour12: false, hour: "2-digit", minute: "2-digit" });
    return {
      date,
      startMin: toMin(hhmm(d)),
      endMin: toMin(hhmm(endD)),
      summary: e.summary,
    };
  });

  return { events, raw: items.map((e) => ({ summary: e.summary, startISO: e.startISO })) };
}

export type ExistingReservation = { slot: Slot; method: MeetingMethod };

/**
 * 二重予約チェック: 仮予約カレンダーの未来イベントに、同一氏名（タイトル先頭一致）の予定が既にあるか。
 * あれば既存の日時・面談方法を返す（新規登録せず同じ文面を再生成するため）。
 */
export function findExistingReservation(
  events: ReservedEvent[],
  candidateName: string,
  now: Date
): ExistingReservation | null {
  const name = candidateName.trim();
  if (!name) return null;

  const todayYmd = jstYmd(now);

  const hits = events
    .filter((e) => e.summary.trim().startsWith(name))
    .filter((e) => e.date >= todayYmd) // 未来（当日以降）の予定のみ
    .sort((a, b) => (a.date === b.date ? a.startMin - b.startMin : a.date < b.date ? -1 : 1));

  const hit = hits[0];
  if (!hit) return null;

  const p = (n: number) => String(n).padStart(2, "0");
  const hhmm = (min: number) => `${p(Math.floor(min / 60))}:${p(min % 60)}`;

  return {
    slot: { date: hit.date, startTime: hhmm(hit.startMin), endTime: hhmm(hit.endMin) },
    // タイトル末尾の面談方法トークン。「電話」以外はオンライン扱い（タイトル生成と対称）。
    method: hit.summary.includes("電話") ? "電話" : "オンライン",
  };
}

export type CreateReservationInput = {
  candidateName: string;
  slot: Slot;
  method: MeetingMethod;
  /** 由来モード（説明欄に記載）。 */
  mode: "task" | "message";
  /** モードAのみ。モードBは null。 */
  taskId?: string | null;
};

/** 仮予約イベントを1件作成する。成功で eventId、失敗で null。 */
export async function createReservation(input: CreateReservationInput): Promise<string | null> {
  const cfg = getReservationConfig();
  if (!cfg) return null;

  const { candidateName, slot, method } = input;
  const summary = `${candidateName} ${eventTitleWhen(slot.date, slot.startTime, slot.endTime)} ${method}`;

  const description = [
    `氏名: ${candidateName}`,
    `面談方法: ${method}`,
    `モード: ${input.mode === "task" ? "taskId 指定（URL申し込み）" : "メッセージ本文（マイナビ直接返信）"}`,
    `元taskId: ${input.taskId ?? "（なし）"}`,
    `作成日時: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`,
    "",
    "AI仮予約（翌朝振り分け・不要なら手動削除）",
  ].join("\n");

  return createCalendarEvent(
    cfg.writerUserId,
    slot.date,
    { summary, startTime: slot.startTime, endTime: slot.endTime, description },
    cfg.calendarId // 共有「仮予約」カレンダーへ明示指定（既定の primary ではない）
  );
}
