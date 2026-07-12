// T-139 step4: 日程調整AIエージェント 共通の JST 日付・時刻ユーティリティ。
// 罠#17: Railway 本番は UTC。`toISOString().slice(0,10)` 系は使わず、必ず timeZone:'Asia/Tokyo' で組む。
import { isBusinessDay } from "@/lib/attendance/business-days";

export const SLOT_MINUTES = 60;
/** 開始時刻の許容範囲。9:00〜20:00（20:00開始＝20:00〜21:00 が最終枠）。 */
export const EARLIEST_START_MIN = 9 * 60;
export const LATEST_START_MIN = 20 * 60;
/** 翌営業日〜この日数以内のみ探索。 */
export const HORIZON_DAYS = 14;

const DOW_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function toMin(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return NaN;
  return h * 60 + mi;
}

export function toHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** JST の暦日（YYYY-MM-DD）。 */
export function jstYmd(d: Date = new Date()): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** JST の時刻（HH:MM）。 */
export function jstHHMM(d: Date = new Date()): string {
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Tokyo",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** YYYY-MM-DD に日数加算（UTC 固定計算＝ローカルTZ非依存）。 */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/** 曜日（日本語1文字）。 */
export function dowJa(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return DOW_JA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** 営業日（平日かつ非祝日）か。business-days.ts の isBusinessDay を再利用。 */
export function isBusinessDayYmd(ymd: string): boolean {
  return isBusinessDay(new Date(`${ymd}T00:00:00+09:00`));
}

/** fromYmd の翌営業日。 */
export function nextBusinessDayYmd(fromYmd: string): string {
  let d = addDaysYmd(fromYmd, 1);
  for (let i = 0; i < 30; i++) {
    if (isBusinessDayYmd(d)) return d;
    d = addDaysYmd(d, 1);
  }
  return d;
}

/** "2026-07-15" + "19:00" → "2026-07-15T19:00:00+09:00" */
export function jstIso(ymd: string, hhmm: string): string {
  return `${ymd}T${hhmm}:00+09:00`;
}

/** "2026-07-15" + "19:00" → "7月15日（火）19:00～"（返信文面・reservedAtLabel 用） */
export function reservedLabel(ymd: string, hhmm: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}月${d}日（${dowJa(ymd)}）${hhmm}～`;
}

/** "2026-07-15","19:00","20:00" → "7/15(火)19:00-20:00"（仮予約イベントのタイトル用） */
export function eventTitleWhen(ymd: string, start: string, end: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}/${d}(${dowJa(ymd)})${start}-${end}`;
}

/**
 * 月日 → 年をサーバー側で機械決定する（LLM に年は出力させない）。
 * executedAt の JST 暦日を基準に「今日以降の最も近い出現」を採る:
 *   今年の月日が今日以降ならその年、過ぎていれば翌年。
 * これにより 12月末実行・1月の月日 → 翌年 が正しく解決される。
 * 返した日付が実際に「翌営業日〜2週間以内」かどうかの判定は呼び出し側（範囲外は候補から除外）。
 */
export function resolveYearNearestFuture(month: number, day: number, now: Date): string | null {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const today = jstYmd(now);
  const baseYear = Number(today.slice(0, 4));
  const p = (n: number) => String(n).padStart(2, "0");
  for (const y of [baseYear, baseYear + 1]) {
    const ymd = `${y}-${p(month)}-${p(day)}`;
    // 存在しない日付（2/30 等）は捨てる
    const [yy, mm, dd] = ymd.split("-").map(Number);
    const probe = new Date(Date.UTC(yy, mm - 1, dd));
    if (probe.getUTCMonth() + 1 !== mm || probe.getUTCDate() !== dd) return null;
    if (ymd >= today) return ymd;
  }
  return null;
}
