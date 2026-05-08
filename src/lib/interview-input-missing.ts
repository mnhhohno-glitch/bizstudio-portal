/**
 * T-046: Interview record input-missing detection.
 *
 * Used in two places:
 *   1. Server side (`/api/interviews` GET) — computes `hasInputMissing` per row
 *      from the Prisma response so the admin list page can show a red badge.
 *   2. Client side (`InterviewForm.tsx`) — computes the same set of missing
 *      keys live from form state to highlight individual fields with a red
 *      border.
 *
 * Both call sites pass slightly different shapes (Prisma `Date` vs. ISO string,
 * full record vs. partial), so the function accepts loose `unknown` types and
 * relies on the per-type emptiness helpers below.
 *
 * Categories (excluded fields are documented inline next to each group):
 *   A: form (InterviewRecord)
 *   B: detail (InterviewDetail) — 転職活動状況
 *   C: detail (InterviewDetail) — 希望条件
 *   D: detail (InterviewDetail) — アクション
 *   E: rating (InterviewRating) — 15 評価項目 + overallRank
 *   F: workHistories — count only (length === 0)
 *
 * Memo-side fields (`*Memo`) are intentionally NOT checked: their requirement
 * depends on the parent flag value, and false positives would be noisy.
 */

export type MissingFieldKey = string;

export interface InputMissingResult {
  hasMissing: boolean;
  missingFields: MissingFieldKey[];
}

export interface CheckInputMissingArgs {
  form: Record<string, unknown> | null | undefined;
  detail: Record<string, unknown> | null | undefined;
  rating: Record<string, unknown> | null | undefined;
  workHistoriesCount: number;
}

const isStringEmpty = (v: unknown): boolean =>
  v == null || (typeof v === "string" && v.trim() === "");

const isIntEmpty = (v: unknown): boolean => v == null;

const isArrayEmpty = (v: unknown): boolean =>
  v == null || (Array.isArray(v) && v.length === 0);

const isDateEmpty = (v: unknown): boolean => {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  // Date instance — treat any non-null Date as filled.
  return false;
};

// Group A — InterviewRecord business fields.
// interviewMemo excluded: AI auto-fill only, no manual UI input.
const FORM_STRING_FIELDS = [
  "startTime",
  "endTime",
  "interviewTool",
  "resultFlag",
] as const;

// Group B — 転職活動状況
const DETAIL_GROUP_B_STRING = [
  "agentUsageFlag",
  "jobChangeTimeline",
  "activityPeriod",
  "applicationTypeFlag",
  "educationFlag",
  "graduationDate",
  "graduationStatus",
] as const;

// Group C — 希望条件 (string flags)
const DETAIL_GROUP_C_STRING = [
  "desiredDayOff",
  "desiredOvertimeMax",
  "desiredTransfer",
  "driverLicenseFlag",
  "languageSkillFlag",
  "japaneseSkillFlag",
  "typingFlag",
  "excelFlag",
  "wordFlag",
  "pptFlag",
] as const;

// Group C — 希望条件 (json arrays)
const DETAIL_GROUP_C_ARRAY = [
  "desiredJobTypes",
  "desiredIndustries",
  "desiredAreas",
] as const;

// Group C — 希望条件 (numeric salary)
const DETAIL_GROUP_C_INT = [
  "currentSalary",
  "desiredSalaryMin",
  "desiredSalaryMax",
] as const;

// Group D — アクション (string)
const DETAIL_GROUP_D_STRING = [
  "documentStatusFlag",
  "documentSupportFlag",
  "contactMethod",
  "jobReferralFlag",
  "nextInterviewFlag",
  "nextInterviewMemo",
  "nextAction",
  "freeMemo",
  "initialSummary",
] as const;

// Group E — InterviewRating 15 項目 (schema.prisma fields)
const RATING_INT_FIELDS = [
  "personalityMotivation",
  "personalityCommunication",
  "personalityManner",
  "personalityIntelligence",
  "personalityHumanity",
  "careerJobType",
  "careerExperience",
  "careerJobChangeCount",
  "careerAchievement",
  "careerQualification",
  "conditionJobType",
  "conditionSalary",
  "conditionHoliday",
  "conditionArea",
  "conditionFlexibility",
] as const;

export function checkInputMissing(args: CheckInputMissingArgs): InputMissingResult {
  const missing: MissingFieldKey[] = [];
  const form = args.form ?? {};
  const detail = args.detail;
  const rating = args.rating;

  // Group A
  if (isDateEmpty((form as Record<string, unknown>).interviewDate)) {
    missing.push("form.interviewDate");
  }
  for (const f of FORM_STRING_FIELDS) {
    if (isStringEmpty((form as Record<string, unknown>)[f])) {
      missing.push(`form.${f}`);
    }
  }

  // Groups B-D
  if (detail) {
    for (const f of DETAIL_GROUP_B_STRING) {
      if (isStringEmpty(detail[f])) missing.push(`d.${f}`);
    }
    if (isIntEmpty(detail.currentApplicationCount)) {
      missing.push("d.currentApplicationCount");
    }

    for (const f of DETAIL_GROUP_C_ARRAY) {
      if (isArrayEmpty(detail[f])) missing.push(`d.${f}`);
    }
    for (const f of DETAIL_GROUP_C_INT) {
      if (isIntEmpty(detail[f])) missing.push(`d.${f}`);
    }
    for (const f of DETAIL_GROUP_C_STRING) {
      if (isStringEmpty(detail[f])) missing.push(`d.${f}`);
    }

    for (const f of DETAIL_GROUP_D_STRING) {
      if (isStringEmpty(detail[f])) missing.push(`d.${f}`);
    }
    // nextInterviewDate / nextInterviewTime: only required when nextInterviewFlag === "設定済"
    if (detail.nextInterviewFlag === "設定済") {
      if (isDateEmpty(detail.nextInterviewDate)) missing.push("d.nextInterviewDate");
      if (isStringEmpty(detail.nextInterviewTime)) missing.push("d.nextInterviewTime");
    }
  } else {
    // Detail row is missing entirely — flag every business field so the form
    // surfaces every empty cell rather than swallowing them silently.
    for (const f of DETAIL_GROUP_B_STRING) missing.push(`d.${f}`);
    missing.push("d.currentApplicationCount");
    for (const f of DETAIL_GROUP_C_ARRAY) missing.push(`d.${f}`);
    for (const f of DETAIL_GROUP_C_INT) missing.push(`d.${f}`);
    for (const f of DETAIL_GROUP_C_STRING) missing.push(`d.${f}`);
    for (const f of DETAIL_GROUP_D_STRING) missing.push(`d.${f}`);
  }

  // Group E — rating (overallRank excluded: auto-calculated from 15 items)
  if (rating) {
    for (const f of RATING_INT_FIELDS) {
      if (isIntEmpty(rating[f])) missing.push(`r.${f}`);
    }
  } else {
    for (const f of RATING_INT_FIELDS) missing.push(`r.${f}`);
  }

  // Group F — workHistories (count only)
  if (args.workHistoriesCount === 0) {
    missing.push("workHistories.__empty__");
  }

  return {
    hasMissing: missing.length > 0,
    missingFields: missing,
  };
}

/** Convenience for client-side: stable Set check is faster for large forms. */
export function buildMissingSet(missingFields: MissingFieldKey[]): Set<MissingFieldKey> {
  return new Set(missingFields);
}
