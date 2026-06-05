// T-071 実績表：6 期間（日/週/月/3か月/半期/年）の定義と from/to 算出。
// すべて「今日起点」、to は常に今日 23:59:59.999 JST（確定仕様）。

import {
  jstDateEnd,
  jstDateStart,
  jstHalfStart,
  jstMonthStart,
  jstQuarterStart,
  jstWeekStart,
  jstYearStart,
} from "./jstDate";

export type PerformancePeriodKey = "day" | "week" | "month" | "quarter" | "half" | "year";

export const PERFORMANCE_PERIODS: { key: PerformancePeriodKey; label: string }[] = [
  { key: "day", label: "日" },
  { key: "week", label: "週" },
  { key: "month", label: "月" },
  { key: "quarter", label: "3か月" },
  { key: "half", label: "半期" },
  { key: "year", label: "年" },
];

/**
 * 指定した JST 日付（"YYYY-MM-DD"）を「今日」とみなし、各期間の from/to を返す。
 * to は常にその日の 23:59:59.999 JST。
 */
export function periodRange(key: PerformancePeriodKey, todayStr: string): { from: Date; to: Date } {
  const to = jstDateEnd(todayStr);
  let from: Date;
  switch (key) {
    case "day":
      from = jstDateStart(todayStr);
      break;
    case "week":
      from = jstWeekStart(todayStr);
      break;
    case "month":
      from = jstMonthStart(todayStr);
      break;
    case "quarter":
      from = jstQuarterStart(todayStr);
      break;
    case "half":
      from = jstHalfStart(todayStr);
      break;
    case "year":
      from = jstYearStart(todayStr);
      break;
  }
  return { from, to };
}
