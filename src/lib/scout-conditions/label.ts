// T-195: 条件の表示名。条件テーブルに名前列は無いので、6軸の要約を「条件「○○」」の ○○ に使う（通知・タスク・画面で共通）。
import { areaLabel, companyCountLabel, gradYearRangeLabel, periodDaysLabel } from "./constants";
import { dbDateToYmd } from "./dates";

export type ConditionLabelRow = {
  id: string;
  searchTarget: string;
  registDateMode: string;
  registDays: number | null;
  registDateFrom: Date | string | null;
  registDateTo: Date | string | null;
  gradYearFrom: number | null;
  gradYearTo: number | null;
  companyCount: number | null;
  residenceMode: string;
  residencePrefectures: string[];
  template: { name: string } | null;
};

const SEARCH_TARGET_SHORT: Record<string, string> = { EXCLUDE: "未送信", ONLY: "送信済", INCLUDE: "含む" };

function ymd(v: Date | string | null): string | null {
  if (v == null) return null;
  return v instanceof Date ? dbDateToYmd(v) : v;
}

/** 例: 「送信済/7日以内/卒15-25/～2社/全国」 */
export function conditionLabel(c: ConditionLabelRow): string {
  const regist =
    c.registDateMode === "PERIOD"
      ? periodDaysLabel(c.registDays)
      : `${ymd(c.registDateFrom) ?? ""}〜${ymd(c.registDateTo) ?? ""}`;
  return [
    SEARCH_TARGET_SHORT[c.searchTarget] ?? c.searchTarget,
    regist,
    `卒${gradYearRangeLabel(c.gradYearFrom, c.gradYearTo)}`,
    companyCountLabel(c.companyCount),
    areaLabel(c.residenceMode, c.residencePrefectures),
  ].join("/");
}
