import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = "Asia/Tokyo";

/** JST の現在時刻 */
export function nowJST() {
  return dayjs().tz(TZ);
}

/** JST の今日 0:00 */
export function todayJST() {
  return dayjs().tz(TZ).startOf("day");
}

/** Date/string を JST の dayjs に変換 */
export function toJST(date: Date | string) {
  return dayjs(date).tz(TZ);
}

/**
 * JST の今日の日付を Prisma @db.Date 用に返す
 * JSTの日付を UTC 同日 00:00:00Z として保存する
 */
export function todayForDB(): Date {
  const jstDate = dayjs().tz(TZ).format("YYYY-MM-DD");
  return new Date(jstDate + "T00:00:00.000Z");
}

/**
 * 任意のJST日付を Prisma @db.Date 用に返す
 */
export function dateForDB(jstDayjs: dayjs.Dayjs): Date {
  return new Date(jstDayjs.format("YYYY-MM-DD") + "T00:00:00.000Z");
}

/** 時刻表示 (H:mm) */
export function formatTime(date: Date | string): string {
  return dayjs(date).tz(TZ).format("H:mm");
}

/** 時刻表示 (HH:mm) */
export function formatTimePadded(date: Date | string): string {
  return dayjs(date).tz(TZ).format("HH:mm");
}

/** 日付表示 (M月D日（曜日）) */
export function formatDate(date: Date | string): string {
  const d = dayjs(date).tz(TZ);
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.month() + 1}月${d.date()}日（${days[d.day()]}）`;
}

export { dayjs, TZ };
