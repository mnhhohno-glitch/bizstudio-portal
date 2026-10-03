// T-206: 公開期限まわりの JST 日付計算。
//   - JST の暦日は toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })（toISOString().slice(0,10) は使わない。罠#17）
//   - expiresAt は「この時刻から見られない」＝ある暦日の 0:00 JST。表示最終日はその前日。
import { DEFAULT_PUBLIC_DAYS } from "./constants";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Date → JST の "YYYY-MM-DD" */
export function jstYmd(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** 今日（JST）の "YYYY-MM-DD" */
export function todayJst(now: Date = new Date()): string {
  return jstYmd(now);
}

/** "YYYY-MM-DD" の 0:00 JST を表す Date */
export function jstMidnight(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+09:00`);
}

/** "YYYY-MM-DD" に日数を足す（暦日計算。UTC 基準で安全に行う） */
export function addDaysYmd(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * 基準日（JST 暦日）を 1 日目として days 日目まで見られる expiresAt。
 * 例: 基準 2026-09-30, 30 日 → 2026-10-30 0:00 JST（表示最終日 10/29）
 */
export function expiresAtFrom(baseYmd: string, days: number = DEFAULT_PUBLIC_DAYS): Date {
  return jstMidnight(addDaysYmd(baseYmd, days));
}

/** expiresAt → 表示最終日（JST "YYYY-MM-DD"）。expiresAt の 1 分前の JST 暦日。 */
export function lastViewableDayYmd(expiresAt: Date): string {
  return jstYmd(new Date(expiresAt.getTime() - 60 * 1000));
}

/** "YYYY-MM-DD" → "M月D日" */
export function formatYmdJa(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

/** "YYYY-MM-DD" → "M/D" */
export function formatYmdShort(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** 面接日などの「JST 暦日」入力（"YYYY-MM-DD"）を UTC 00:00 の Date に（罠#17: 暦日カラムの保存形式） */
export function ymdToUtcDate(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
