// T-208 step2: 台本の自動計算（すべて純粋関数。AI・DB は使わない）。
// - 月給（控除前）＝（賞与込みの年収 − 賞与の年額）÷ 12、手取り＝月給 × 0.8（目安）
// - 残業の 1日 ↔ 月は ×20 / ÷20
// - 希望残業の選択肢は月の時間から自動で選ぶ（付録A）
// - 次回面談の内容・時期の目安、スケジュールの見通し（内定の目安・入社の目安）は転職時期の答えから

import { DESIRED_OVERTIME_OPTIONS } from "./field-options";

/** 文字→数値（全角数字・カンマ・単位混じりでも先頭の数だけ読む）。読めなければ null */
export function parseNumber(v: string | null | undefined): number | null {
  if (v == null) return null;
  const s = String(v)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．]/g, ".")
    .replace(/,/g, "");
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** 万円の表示（小数は1桁まで・末尾の .0 は消す） */
export function formatMan(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export type SalaryCalcInput = {
  /** 年収（万円） */
  annualMan: number | null;
  /** 年収に賞与が含まれているか（null=未回答） */
  bonusIncluded: boolean | null;
  /** 賞与の年額（万円）。無し・未回答は null */
  bonusAnnualMan: number | null;
};

export type SalaryCalcResult = { monthlyMan: number | null; takeHomeMan: number | null };

/**
 * 月給（控除前）と手取りの目安。
 * 年収に賞与が含まれていれば賞与の年額を引いてから 12 で割る。含まれていなければ年収をそのまま 12 で割る。
 * 「含まれている」のに賞与の額が分からないときは計算しない（null）。
 */
export function calcSalary(input: SalaryCalcInput): SalaryCalcResult {
  const { annualMan, bonusIncluded, bonusAnnualMan } = input;
  if (annualMan == null || annualMan <= 0) return { monthlyMan: null, takeHomeMan: null };
  let base: number;
  if (bonusIncluded === true) {
    if (bonusAnnualMan == null) return { monthlyMan: null, takeHomeMan: null };
    base = annualMan - bonusAnnualMan;
  } else if (bonusIncluded === false) {
    base = annualMan;
  } else {
    return { monthlyMan: null, takeHomeMan: null };
  }
  if (base <= 0) return { monthlyMan: null, takeHomeMan: null };
  const monthlyMan = base / 12;
  return { monthlyMan, takeHomeMan: monthlyMan * 0.8 };
}

export const OVERTIME_DAYS_PER_MONTH = 20;

export function overtimeDayToMonth(perDayHours: number): number {
  return perDayHours * OVERTIME_DAYS_PER_MONTH;
}

export function overtimeMonthToDay(perMonthHours: number): number {
  return perMonthHours / OVERTIME_DAYS_PER_MONTH;
}

/** 残業の時間表示（小数1桁まで） */
export function formatHours(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * 月の残業時間 → 希望残業の選択肢（付録A）。
 * 0→絶対不可、〜10→10時間以内、〜20→20時間以内、〜30→30時間以内、〜45→45時間以内、46以上→45時間超も可
 */
export function overtimeOptionFor(monthHours: number | null): string | null {
  if (monthHours == null || monthHours < 0) return null;
  let label: string;
  if (monthHours === 0) label = "絶対不可";
  else if (monthHours <= 10) label = "10時間以内";
  else if (monthHours <= 20) label = "20時間以内";
  else if (monthHours <= 30) label = "30時間以内";
  else if (monthHours <= 45) label = "45時間以内";
  else label = "45時間超も可";
  return DESIRED_OVERTIME_OPTIONS.includes(label) ? label : null;
}

/** 転職時期（画面の選択肢）が「急ぎ」か（付録A: 急ぎ＝すぐにでも・3カ月以内・半年以内、先＝1年以内・未定） */
export function isHurryTimeline(timeline: string | null | undefined): boolean {
  return timeline === "すぐにでも" || timeline === "3カ月以内" || timeline === "半年以内";
}

export type NextInterviewGuide = { content: string; timing: string; hurry: boolean };

/**
 * 次回面談の内容と時期の目安（付録A で置き直した版）。
 * - 内容: 急ぎ（すぐにでも・3カ月以内・半年以内）＝求人を一緒に見ながら応募先を決める／先＝職種の理解から
 * - 時期: すぐにでも・3カ月以内・選考中あり → 今週か来週／半年以内 → 1〜2週間後くらい／1年以内・未定 → 2週間〜1ヶ月後くらい
 */
export function nextInterviewGuide(timeline: string | null | undefined, hasSelection: boolean): NextInterviewGuide {
  const hurry = isHurryTimeline(timeline) || hasSelection;
  const content = hurry
    ? "お探しした求人を一緒に見ながら、応募先を決めていく形"
    : "職種の理解や、ほかの職種の選択肢のご説明から始めて、求人のご説明もあわせて行う形";
  let timing: string;
  if (timeline === "すぐにでも" || timeline === "3カ月以内" || hasSelection) timing = "今週か来週";
  else if (timeline === "半年以内") timing = "1〜2週間後くらい";
  else timing = "2週間〜1ヶ月後くらい";
  return { content, timing, hurry };
}

/** 月を足した日付。表示は年月だけなので日は 1 日に寄せる（月末の繰り上がりで月がずれないように） */
export function addMonths(base: Date, months: number): Date {
  return new Date(base.getFullYear(), base.getMonth() + months, 1);
}

function ym(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

/** 「2026年11月〜12月」のような範囲表示（同じ年なら2つ目は月だけ） */
export function formatMonthRange(from: Date, to: Date): string {
  if (from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth()) return ym(from);
  const toLabel = from.getFullYear() === to.getFullYear() ? `${to.getMonth() + 1}月` : ym(to);
  return `${ym(from)}〜${toLabel}`;
}

export type ScheduleOutlookInput = {
  /** 次回面談の日（未設定なら今日） */
  nextInterviewDate: Date;
  /** 在職中か */
  employed: boolean;
  /** 在職中のとき「退職の予定」で聞いた月数（聞けていなければ null → 1〜2ヶ月） */
  retireMonths: number | null;
};

export type ScheduleOutlook = { offerLabel: string; joinLabel: string };

/**
 * スケジュールの見通し。
 * - 内定の目安 = 次回面談の 1〜2ヶ月後
 * - 入社の目安 = 内定の目安 ＋ 在職中なら退職までの月数（聞けていなければ 1〜2ヶ月）、辞めている人なら 1ヶ月
 */
export function scheduleOutlook(input: ScheduleOutlookInput): ScheduleOutlook {
  const offerFrom = addMonths(input.nextInterviewDate, 1);
  const offerTo = addMonths(input.nextInterviewDate, 2);
  let joinMin: number;
  let joinMax: number;
  if (!input.employed) {
    joinMin = 1;
    joinMax = 1;
  } else if (input.retireMonths != null && input.retireMonths > 0) {
    joinMin = Math.ceil(input.retireMonths);
    joinMax = joinMin;
  } else {
    joinMin = 1;
    joinMax = 2;
  }
  return {
    offerLabel: formatMonthRange(offerFrom, offerTo),
    joinLabel: formatMonthRange(addMonths(offerFrom, joinMin), addMonths(offerTo, joinMax)),
  };
}
