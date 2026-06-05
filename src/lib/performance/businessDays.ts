// T-073: 営業日数（土日＋祝日を除く）と週按分。
// 祝日は @holiday-jp/holiday_jp（attendance/business-days.ts と同じソース）を使う。
// すべて JST のカレンダー日付で扱う（罠 #17）。月の日付は壁時計日付で列挙する。

import holiday_jp from "@holiday-jp/holiday_jp";

export interface WeekBucket {
  weekIndex: number; // 0 始まり（その月の中での通し番号）
  startDate: string; // "YYYY-MM-DD"（その週が月内に持つ最初の日）
  endDate: string; // "YYYY-MM-DD"（その週が月内に持つ最後の日）
  businessDays: number; // その週（月内に限る）の営業日数
}

// 壁時計日付 (y, m1-12, d) が営業日か。土日・祝日を除く。
function isBusinessDay(year: number, month1: number, day: number): boolean {
  // 祝日判定用は JST 正午の Date を渡す（holiday_jp は Date の年月日を見る。DST 無しの JST で安全）。
  const d = new Date(year, month1 - 1, day, 12, 0, 0);
  const dow = d.getDay(); // ローカル基準だが (y,m,d,12) は日付がずれないため曜日は正しい
  if (dow === 0 || dow === 6) return false;
  if (holiday_jp.isHoliday(d)) return false;
  return true;
}

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 指定月（"YYYY-MM"）の営業日数（土日＋祝日除く）。 */
export function monthBusinessDays(yearMonth: string): number {
  const [year, month1] = yearMonth.split("-").map((s) => parseInt(s, 10));
  const last = daysInMonth(year, month1);
  let count = 0;
  for (let d = 1; d <= last; d++) {
    if (isBusinessDay(year, month1, d)) count++;
  }
  return count;
}

/**
 * 指定月を週（月曜始まり）に分割し、各週が月内に持つ営業日数を返す。
 * 週は月をまたがず、月内の日だけを各週に割り当てる（月初・月末の部分週も1週として扱う）。
 */
export function weeklyBusinessDays(yearMonth: string): WeekBucket[] {
  const [year, month1] = yearMonth.split("-").map((s) => parseInt(s, 10));
  const last = daysInMonth(year, month1);
  const buckets: WeekBucket[] = [];

  let current: WeekBucket | null = null;
  let weekIndex = 0;

  for (let d = 1; d <= last; d++) {
    const dateObj = new Date(year, month1 - 1, d, 12, 0, 0);
    const dow = dateObj.getDay(); // 0=日,1=月,...,6=土
    const dateStr = `${year}-${pad(month1)}-${pad(d)}`;

    // 月曜（dow=1）または月初で新しい週を開始
    if (current === null || dow === 1) {
      current = { weekIndex: weekIndex++, startDate: dateStr, endDate: dateStr, businessDays: 0 };
      buckets.push(current);
    }
    current.endDate = dateStr;
    if (isBusinessDay(year, month1, d)) current.businessDays++;
  }

  return buckets;
}

/**
 * 月目標（小数）を各週へ営業日按分する。
 * - 各週 = 月目標 ÷ 月営業日 × その週営業日 を **切り上げ** で表示。
 * - ただし合計が月目標に一致するよう **最終週で調整**（最終週 = 月目標 − 他週の合計）。
 * - 営業日のない週（businessDays=0）は 0。
 * 戻り値は週ごとの数値（最終週以外は切り上げ整数、最終週は帳尻＝小数になり得る）。
 */
export function allocateToWeeks(monthTarget: number, weeks: WeekBucket[]): number[] {
  const totalBiz = weeks.reduce((s, w) => s + w.businessDays, 0);
  if (totalBiz <= 0) return weeks.map(() => 0);

  // 営業日を持つ週のうち最後を「最終週（帳尻）」にする。
  let lastBizIdx = -1;
  for (let i = 0; i < weeks.length; i++) {
    if (weeks[i].businessDays > 0) lastBizIdx = i;
  }

  const result: number[] = new Array(weeks.length).fill(0);
  let allocated = 0;
  for (let i = 0; i < weeks.length; i++) {
    if (weeks[i].businessDays === 0) {
      result[i] = 0;
      continue;
    }
    if (i === lastBizIdx) continue; // 最終週は後で帳尻
    const raw = (monthTarget / totalBiz) * weeks[i].businessDays;
    const ceiled = Math.ceil(raw);
    result[i] = ceiled;
    allocated += ceiled;
  }
  if (lastBizIdx >= 0) {
    result[lastBizIdx] = monthTarget - allocated; // 合計＝月目標を保証
  }
  return result;
}
