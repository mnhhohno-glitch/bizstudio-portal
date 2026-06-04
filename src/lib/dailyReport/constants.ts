// T-066: 日報の固定値群。仕様 4-1 の「辞退系」定義とフォーマット切替の単一ソース。

/**
 * 面談「実施数」から除外する resultFlag のリスト。
 * これら以外（null を含む）はすべて実施済みとして扱う（仕様 4-1）。
 *
 * これらの値は InterviewListClient などの UI 定数と独立して持つこと。
 * UI 定数を流用してしまうと、UI で「初回面談」「辞退系」の表示文言を変えたときに
 * 集計ロジックが連動して壊れる事故が起きる。
 */
export const INTERVIEW_DECLINED_FLAGS = [
  "連絡なし辞退",
  "連絡あり辞退",
  "辞退",
] as const;

export type InterviewDeclinedFlag = (typeof INTERVIEW_DECLINED_FLAGS)[number];

/** 面接対策の interviewType 文字列。仕様 4-2 の「面接対策数」用。 */
export const INTERVIEW_TYPE_INTERVIEW_PREP = "面接対策";

/** 日報フォーマット種別。職種ごとに何を出すかを 1 箇所に集約する。 */
export type DailyReportFormat = "CA" | "MARKETING" | "OFFICE_AND_MGMT" | "FALLBACK_COMMENT_ONLY";

/**
 * Employee.jobCategory → 日報フォーマットの解決。
 * NULL の場合は安全側でコメントのみフォーマットに倒す（仕様 Phase 5）。
 */
export function resolveDailyReportFormat(
  jobCategory: "CA" | "MARKETING" | "OFFICE_AND_MGMT" | null | undefined,
): DailyReportFormat {
  if (jobCategory === "CA") return "CA";
  if (jobCategory === "MARKETING") return "MARKETING";
  if (jobCategory === "OFFICE_AND_MGMT") return "OFFICE_AND_MGMT";
  return "FALLBACK_COMMENT_ONLY";
}

/** フォーマット種別が「数値を含むか」。CA のみ true。 */
export function formatHasNumbers(format: DailyReportFormat): boolean {
  return format === "CA";
}
