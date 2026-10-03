// 書類通過日（JobEntry.documentPassDate）の日付定義と、段階変更時の自動入力ルールを 1 か所にまとめる。
//
// 日付定義（書類選考タブのインライン編集 InlineDateCell と同じ）:
//   - 保存値 = 入力した JST 日付 "YYYY-MM-DD" の "T12:00:00.000Z"（UTC 正午 = JST 21:00 同日）。
//   - 表示値 = 保存値を Asia/Tokyo で読んだ日付。UTC 00:00〜14:59 に保存された既存値（自動入力の UTC 0 時など）
//     も同じ JST 日付になるため、再表示と月別集計（jstMonthStart〜jstNextMonthStart の JST 範囲）が一致する。
//   - 罠 #17：toISOString().slice(0,10) で JST 日付を作らない。

import { jstDateStringToDbDate, toJstDateString } from "@/lib/dailyReport/jstDate";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 画面の <input type="date"> に入れる値（JST 日付）。空なら "" */
export function documentPassDateToInput(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  return toJstDateString(d);
}

/** 画面の入力値（JST 日付 "YYYY-MM-DD" または ""）→ PATCH に送る値。空欄は null（クリア） */
export function documentPassDateFromInput(ymd: string): string | null {
  if (!ymd) return null;
  if (!YMD_RE.test(ymd)) throw new Error(`invalid date: ${ymd}`);
  return `${ymd}T12:00:00.000Z`;
}

/** PATCH 本文の documentPassDate を検証する。null/空文字=クリア、日付として読めない値は false */
export function isValidDocumentPassDateBody(val: unknown): boolean {
  if (val === null || val === "") return true;
  if (typeof val !== "string") return false;
  return !isNaN(new Date(val).getTime());
}

/**
 * 本文が「書類通過日だけ」を変える更新か。
 * この場合は選考フラグ・連絡状況・有効/無効状態を再計算しない（日付の訂正で状態を動かさない）。
 */
export function isDocumentPassDateOnlyUpdate(body: Record<string, unknown>): boolean {
  const keys = Object.keys(body);
  return keys.length > 0 && keys.every((k) => k === "documentPassDate");
}

/**
 * 段階変更（flags API）で自動入力する日付を決める。既に値が入っている欄は上書きしない（手入力値を保護）。
 *  - entryFlag が「書類選考」→ 書類提出日
 *  - entryFlag が「面接 / 内定 / 入社済」→ 書類通過日
 *  - entryFlag が「内定」→ 内定日
 *  - entryFlagDetail が「承諾」→ 承諾日
 */
export function stageAutoDates(
  change: { entryFlag?: string; entryFlagDetail?: string },
  existing: { documentSubmitDate: Date | null; documentPassDate: Date | null; offerDate: Date | null; acceptanceDate: Date | null },
  todayJst: string,
): Partial<Record<"documentSubmitDate" | "documentPassDate" | "offerDate" | "acceptanceDate", Date>> {
  const out: Partial<Record<"documentSubmitDate" | "documentPassDate" | "offerDate" | "acceptanceDate", Date>> = {};
  const today = jstDateStringToDbDate(todayJst);
  const { entryFlag, entryFlagDetail } = change;
  const reachedInterviewOrBeyond = entryFlag === "面接" || entryFlag === "内定" || entryFlag === "入社済";
  if (entryFlag === "書類選考" && existing.documentSubmitDate == null) out.documentSubmitDate = today;
  if (reachedInterviewOrBeyond && existing.documentPassDate == null) out.documentPassDate = today;
  if (entryFlag === "内定" && existing.offerDate == null) out.offerDate = today;
  if (entryFlagDetail === "承諾" && existing.acceptanceDate == null) out.acceptanceDate = today;
  return out;
}

/** stageAutoDates が何か入れる可能性がある変更か（既存値の読み込みが要るか） */
export function needsStageAutoDates(change: { entryFlag?: string; entryFlagDetail?: string }): boolean {
  const f = change.entryFlag;
  return f === "書類選考" || f === "面接" || f === "内定" || f === "入社済" || change.entryFlagDetail === "承諾";
}
