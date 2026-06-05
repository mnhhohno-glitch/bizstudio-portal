// T-066: JST 境界ヘルパ。罠 #17 と 4-4 を厳守。
//
// 既存 src/lib/attendance/timezone.ts は dayjs ベースで「JST 日付 → UTC midnight Date」を返す。
// 日報の集計は「JST 当日の 0:00〜23:59:59.999」を Date 範囲で取る必要があり、
// dailyAttendance のような @db.Date 用とは要件が違うので別関数を切る。

/**
 * JST 現在時刻の日付文字列を "YYYY-MM-DD" で返す。
 * toISOString().slice(0,10) は UTC 基準で 9 時間ずれるので絶対に使わない（罠 #17）。
 */
export function todayJstDateString(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/**
 * 任意の Date を JST 日付文字列 "YYYY-MM-DD" に変換する。
 */
export function toJstDateString(date: Date): string {
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/**
 * "YYYY-MM-DD"（JST 日付）を「その日の JST 0:00:00 を表す Date」に変換する。
 * 範囲下限の指定に使う。googleCalendar.ts L66 と同じパターン。
 */
export function jstDateStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+09:00`);
}

/**
 * "YYYY-MM-DD"（JST 日付）を「その日の JST 23:59:59.999 を表す Date」に変換する。
 * 範囲上限の指定に使う。
 */
export function jstDateEnd(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999+09:00`);
}

/**
 * "YYYY-MM-DD"（JST 日付）から「当月初日 00:00 JST」を Date で返す。
 * 月の初日は dateStr の YYYY-MM-01 を採用する。
 */
export function jstMonthStart(dateStr: string): Date {
  const [year, month] = dateStr.split("-");
  return new Date(`${year}-${month}-01T00:00:00+09:00`);
}

/**
 * "YYYY-MM-DD"（JST 日付）から「翌月初日 00:00 JST」を Date で返す（=当月排他上限）。
 */
export function jstNextMonthStart(dateStr: string): Date {
  const [year, month] = dateStr.split("-").map((s) => parseInt(s, 10));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const mm = String(nextMonth).padStart(2, "0");
  return new Date(`${nextYear}-${mm}-01T00:00:00+09:00`);
}

/**
 * "YYYY-MM-DD"（JST 日付）から「Prisma @db.Date 用の UTC midnight Date」を返す。
 * 既存 DailySchedule.date と同じパターン（R7）。
 */
export function jstDateStringToDbDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

// ============================================================
// T-071 実績表：期間レンジの起点ヘルパ（今日起点・to は常に今日）
// すべて JST。toISOString().slice(0,10) は使わない（罠 #17/#36）。
// ============================================================

/**
 * "YYYY-MM-DD"（JST）から「当週の月曜 0:00 JST」を返す。週起点は月曜（確定仕様）。
 * 曜日は JST の getDay() ではなく、日付文字列から決定的に算出する。
 */
export function jstWeekStart(dateStr: string): Date {
  // dateStr の JST 0:00 を基準に、月曜まで戻す。
  // new Date(`${dateStr}T00:00:00+09:00`).getUTCDay() で曜日を取得（0=日,1=月,...,6=土）。
  const base = new Date(`${dateStr}T00:00:00+09:00`);
  const dow = jstDayOfWeek(dateStr); // 0=日,1=月,...
  // 月曜起点：月曜=0 戻り、日曜=6 戻り
  const daysBack = (dow + 6) % 7;
  const monday = new Date(base.getTime() - daysBack * 24 * 60 * 60 * 1000);
  // monday は JST 0:00 を指す Date。
  return monday;
}

/**
 * "YYYY-MM-DD"（JST）の曜日（0=日,1=月,...,6=土）を返す。
 * dateStr は壁時計日付なので、UTC Date に詰めて getUTCDay で確実に取る。
 */
export function jstDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * "YYYY-MM-DD"（JST）から「直近3か月の起点 = 2か月前の月初 0:00 JST」を返す。
 * 例：6月 → 4/1。
 */
export function jstQuarterStart(dateStr: string): Date {
  const [year, month] = dateStr.split("-").map((s) => parseInt(s, 10));
  let y = year;
  let m = month - 2; // 2か月前
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  const mm = String(m).padStart(2, "0");
  return new Date(`${y}-${mm}-01T00:00:00+09:00`);
}

/**
 * "YYYY-MM-DD"（JST）から「半期初日 0:00 JST」を返す。暦半期（1〜6月→1/1、7〜12月→7/1）。
 */
export function jstHalfStart(dateStr: string): Date {
  const [year, month] = dateStr.split("-").map((s) => parseInt(s, 10));
  const startMonth = month <= 6 ? "01" : "07";
  return new Date(`${year}-${startMonth}-01T00:00:00+09:00`);
}

/**
 * "YYYY-MM-DD"（JST）から「年初 1/1 0:00 JST」を返す。
 */
export function jstYearStart(dateStr: string): Date {
  const year = dateStr.slice(0, 4);
  return new Date(`${year}-01-01T00:00:00+09:00`);
}
