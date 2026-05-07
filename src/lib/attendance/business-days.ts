import holiday_jp from "@holiday-jp/holiday_jp";

export function isBusinessDay(date: Date): boolean {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  if (holiday_jp.isHoliday(date)) return false;
  return true;
}

export function countBusinessDays(year: number, month: number): number {
  let count = 0;
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const day = date.getDay();
    if (day === 0 || day === 6) continue;
    if (holiday_jp.isHoliday(date)) continue;
    count++;
  }
  return count;
}
