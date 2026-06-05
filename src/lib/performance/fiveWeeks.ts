// T-071 週マトリクス：起算日から 5 週に分割するヘルパ。
// - W1：起算日 〜 その週の日曜（端数になり得る。例：水曜起算なら水〜日の5日）
// - W2〜W5：月曜〜日曜の暦週（フル週）
// - すべて JST。各週の from = その日の 0:00 JST、to = 日曜 23:59:59.999 JST。
// 罠 #17 厳守：壁時計日付の操作のみ、toISOString().slice(0,10) は使わない。

import holiday_jp from "@holiday-jp/holiday_jp";
import { jstDayOfWeek } from "@/lib/dailyReport/jstDate";

const DAY_MS = 24 * 60 * 60 * 1000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** JST の "YYYY-MM-DD" に日数を加算した日付文字列を返す。 */
function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map((s) => parseInt(s, 10));
  // UTC ベースで加算（JST 壁時計日付を直接動かす）
  const t = Date.UTC(y, m - 1, d) + delta * DAY_MS;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** その JST 日付の 0:00 JST を Date で返す。 */
function jstStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+09:00`);
}
/** その JST 日付の 23:59:59.999 JST を Date で返す。 */
function jstEnd(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999+09:00`);
}

export interface WeekRange {
  weekIndex: number; // 0..4
  label: string; // "W1"〜"W5"
  fromDateStr: string; // "YYYY-MM-DD"
  toDateStr: string;
  from: Date;
  to: Date;
  businessDays: number; // この週の営業日数（土日祝除く、@holiday-jp）
}

/**
 * 起算日（JST "YYYY-MM-DD"）から 5 週分の {from, to} を返す。
 * W1 は起算日 〜 その週の最初の日曜まで（端数）。
 * W2〜W5 は月〜日のフル暦週。
 */
export function splitIntoFiveWeeks(anchorDateStr: string): WeekRange[] {
  // W1 の終了 = anchor からその週の日曜まで（dow=0:日, 1:月, ..., 6:土）
  // 「その週」＝ 月曜起点なので、anchor の dow から日曜までの日数を求める
  const anchorDow = jstDayOfWeek(anchorDateStr); // 0..6
  // 月曜起点の週における「日曜までの残日数」：
  //   dow=1(月) → 6日後が日曜
  //   dow=2(火) → 5日後
  //   ...
  //   dow=6(土) → 1日後
  //   dow=0(日) → 0日後（その日が日曜）
  const daysToSunday = anchorDow === 0 ? 0 : 7 - anchorDow;

  const buckets: WeekRange[] = [];

  // W1
  const w1End = addDays(anchorDateStr, daysToSunday);
  buckets.push(makeWeek(0, "W1", anchorDateStr, w1End));

  // W2〜W5：W1終了の翌日（月曜）から月〜日のフル暦週を4本
  let nextStart = addDays(w1End, 1);
  for (let i = 1; i <= 4; i++) {
    const end = addDays(nextStart, 6); // 月〜日 = 7日間
    buckets.push(makeWeek(i, `W${i + 1}`, nextStart, end));
    nextStart = addDays(end, 1);
  }

  return buckets;
}

function makeWeek(idx: number, label: string, fromStr: string, toStr: string): WeekRange {
  return {
    weekIndex: idx,
    label,
    fromDateStr: fromStr,
    toDateStr: toStr,
    from: jstStart(fromStr),
    to: jstEnd(toStr),
    businessDays: countBusinessDays(fromStr, toStr),
  };
}

function countBusinessDays(fromStr: string, toStr: string): number {
  let count = 0;
  let cursor = fromStr;
  while (cursor <= toStr) {
    const [y, m, d] = cursor.split("-").map((s) => parseInt(s, 10));
    // 祝日判定用に JST 正午の Date を渡す（DST 無しの JST なので安全）
    const dt = new Date(y, m - 1, d, 12, 0, 0);
    const dow = dt.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isHoliday = holiday_jp.isHoliday(dt);
    if (!isWeekend && !isHoliday) count++;
    cursor = addDays(cursor, 1);
  }
  return count;
}
