import holiday_jp from "@holiday-jp/holiday_jp";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function isBusinessDay(date: Date): boolean {
  const jstDate = new Date(date.getTime() + JST_OFFSET_MS);
  const day = jstDate.getUTCDay();
  if (day === 0 || day === 6) return false;
  if (holiday_jp.isHoliday(jstDate)) return false;
  return true;
}

export function countBusinessDays(year: number, month: number): number {
  let count = 0;
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    if (isBusinessDay(new Date(year, month - 1, d))) count++;
  }
  return count;
}
