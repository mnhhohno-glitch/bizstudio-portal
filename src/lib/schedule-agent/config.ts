// T-139 step4: 日程調整AIエージェントの環境変数アクセサ。
//
// SCHEDULE_RESERVATION_CALENDAR_ID / SCHEDULE_RESERVATION_WRITER_USER_ID のどちらかが未設定なら
// 枠取り・カレンダー登録を一切行わず「返信不要(no_reply)」で安全終了する（誤送信防止・Q5確定事項）。

/** 仮予約カレンダー設定。どちらか欠けたら null（＝機能を動かさない）。 */
export function getReservationConfig(): { calendarId: string; writerUserId: string } | null {
  const calendarId = process.env.SCHEDULE_RESERVATION_CALENDAR_ID?.trim();
  const writerUserId = process.env.SCHEDULE_RESERVATION_WRITER_USER_ID?.trim();
  if (!calendarId || !writerUserId) return null;
  return { calendarId, writerUserId };
}

/** 空き判定の対象CA（カンマ区切り・ハードコード禁止）。 */
export function getTargetUserIds(): string[] {
  return (process.env.SCHEDULE_AGENT_TARGET_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** テンプレC/D に差し込む日程登録フォームURL。env があれば上書き。 */
export const DEFAULT_SCHEDULE_FORM_URL = "https://schedule.bizstudio.co.jp/";
export function getScheduleFormUrl(): string {
  const u = process.env.SCHEDULE_FORM_URL?.trim();
  return u && u.length > 0 ? u : DEFAULT_SCHEDULE_FORM_URL;
}
