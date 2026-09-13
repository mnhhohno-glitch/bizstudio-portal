// T-194: 日付表示の共通ヘルパー（事故防止のため全画面で曜日つき・土曜青・日曜/祝日赤）
// JST 変換は toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) を使う。toISOString().slice は使わない（罠#17）。

export const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 現在の JST 日付 "YYYY-MM-DD" */
export function jstTodayYmd(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** 真の instant（ISO文字列/Date）→ JST の "YYYY-MM-DD" */
export function instantToJstYmd(v: string | Date): string {
  return new Date(v).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** 真の instant → JST の "YYYY-MM-DD HH:mm" */
export function instantToJstDateTime(v: string | Date): string {
  return new Date(v).toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }).slice(0, 16);
}

/** "YYYY-MM-DD" に日数を加算（壁時計のまま演算。UTC 正午基準で TZ の影響を受けない） */
export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toLocaleDateString("sv-SE", { timeZone: "UTC" });
}

/** "YYYY-MM-DD" の曜日番号（0=日 … 6=土） */
export function ymdWeekday(ymd: string): number {
  return new Date(`${ymd}T12:00:00.000Z`).getUTCDay();
}

export function ymdWeekdayLabel(ymd: string): string {
  return WEEKDAY_JA[ymdWeekday(ymd)];
}

export type HolidayMap = Record<string, string>; // "YYYY-MM-DD" → 祝日名

export type DayKind = "weekday" | "sat" | "sun" | "holiday";

export function dayKind(ymd: string, holidays: HolidayMap): DayKind {
  if (holidays[ymd]) return "holiday";
  const wd = ymdWeekday(ymd);
  if (wd === 6) return "sat";
  if (wd === 0) return "sun";
  return "weekday";
}

/** 土曜=青 / 日曜・祝日=赤 / 平日=通常 */
export function dayColorClass(kind: DayKind): string {
  if (kind === "sat") return "text-[#2563EB]";
  if (kind === "sun" || kind === "holiday") return "text-[#DC2626]";
  return "";
}

/** "2026-09-21" → "2026-09-21(月)" */
export function formatYmdWithWeekday(ymd: string): string {
  return `${ymd}(${ymdWeekdayLabel(ymd)})`;
}

/** "2026-09-21" → "9/21(月)" */
export function formatYmdShort(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}(${ymdWeekdayLabel(ymd)})`;
}

/** @db.Date を Prisma が返す Date（UTC 0時）→ "YYYY-MM-DD"。UTC 0時は JST 9時なので Asia/Tokyo 変換で同じ日付になる */
export function dbDateToYmd(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** "YYYY-MM-DD" → @db.Date 格納用 Date（UTC 0時に載せる） */
export function ymdToDbDate(ymd: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`日付の形式が不正です: ${ymd}`);
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function isValidYmd(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toLocaleDateString("sv-SE", { timeZone: "UTC" }) === s;
}
