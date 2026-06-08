// T-071 実績表マトリクスの列生成（粒度 day/week/month）。
// - day  ：起算日から 5 日（各列 1 日）
// - week ：起算日から 5 週（W1=起算日〜最初の日曜、W2-5=月〜日。splitIntoFiveWeeks）
// - month：起算月から 6 ヶ月（各列 1 暦月）
// すべて JST。各列 from=0:00 JST、to=末の 23:59:59.999 JST（罠 #17）。

import holiday_jp from "@holiday-jp/holiday_jp";
import { splitIntoFiveWeeks } from "./fiveWeeks";
import { monthBusinessDays } from "./businessDays";

export type Granularity = "day" | "week" | "month";

export interface MatrixColumn {
  index: number;
  label: string; // "5/25" | "W1" | "2026-06"
  subLabel: string | null; // 週は日付範囲
  fromDateStr: string; // "YYYY-MM-DD"
  toDateStr: string;
  from: Date;
  to: Date;
  businessDays: number; // 列内の営業日数（day は 0 or 1）
  yearMonth: string; // 目標参照用（month は列の月、day/week は起算月）
}

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y, m - 1, d) + delta * DAY_MS);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map((s) => parseInt(s, 10));
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}
function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map((s) => parseInt(s, 10));
  return new Date(y, m, 0).getDate();
}
function jstStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+09:00`);
}
function jstEnd(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999+09:00`);
}
function mdLabel(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}
function isBusinessDay(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map((s) => parseInt(s, 10));
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  const dow = dt.getDay();
  return dow !== 0 && dow !== 6 && !holiday_jp.isHoliday(dt);
}

export function buildColumns(granularity: Granularity, anchorDate: string): MatrixColumn[] {
  const anchorMonth = anchorDate.slice(0, 7);

  if (granularity === "day") {
    const cols: MatrixColumn[] = [];
    for (let i = 0; i < 5; i++) {
      const ds = addDays(anchorDate, i);
      cols.push({
        index: i,
        label: mdLabel(ds),
        subLabel: null,
        fromDateStr: ds,
        toDateStr: ds,
        from: jstStart(ds),
        to: jstEnd(ds),
        businessDays: isBusinessDay(ds) ? 1 : 0,
        yearMonth: ds.slice(0, 7),
      });
    }
    return cols;
  }

  if (granularity === "month") {
    // T-086: 半年タブは「起算月を含む過去6ヶ月」を昇順表示（旧→新）。
    // 起算 2026-06 のとき [2026-01, 2026-02, 2026-03, 2026-04, 2026-05, 2026-06]（右端=起算月）。
    // 旧実装は i=0..5 で未来方向 +0〜+5（起算月から未来6ヶ月）になっており当月以外0だった。
    // ※「直近6ヶ月」タブ(/api/performance/cohort)は当月除外の -6〜-1 で別ロジック・別ルート。
    const cols: MatrixColumn[] = [];
    for (let i = 0; i < 6; i++) {
      const ym = shiftMonth(anchorMonth, i - 5);
      const first = `${ym}-01`;
      const last = `${ym}-${pad(daysInMonth(ym))}`;
      cols.push({
        index: i,
        label: ym,
        subLabel: null,
        fromDateStr: first,
        toDateStr: last,
        from: jstStart(first),
        to: jstEnd(last),
        businessDays: monthBusinessDays(ym),
        yearMonth: ym,
      });
    }
    return cols;
  }

  // week
  return splitIntoFiveWeeks(anchorDate).map((w) => ({
    index: w.weekIndex,
    label: w.label,
    subLabel: `${mdLabel(w.fromDateStr)}〜${mdLabel(w.toDateStr)}`,
    fromDateStr: w.fromDateStr,
    toDateStr: w.toDateStr,
    from: w.from,
    to: w.to,
    businessDays: w.businessDays,
    yearMonth: anchorMonth,
  }));
}
