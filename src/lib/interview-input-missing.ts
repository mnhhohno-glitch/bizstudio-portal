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

// Group D — アクション (string).
// nextAction / freeMemo / initialSummary excluded from this list and handled
// as a combined group below: the form renders all three through one textarea
// (`d.nextAction || d.freeMemo || d.initialSummary || ...`), so they should
// only count as missing when all three are empty.
const DETAIL_GROUP_D_STRING = [
  "documentStatusFlag",
  "documentSupportFlag",
  "contactMethod",
  "jobReferralFlag",
  "nextInterviewFlag",
  "nextInterviewMemo",
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

// Result flags that mean the interview never actually took place. When the
// resultFlag has one of these values, business-field validation is skipped:
// only resultFlag itself is required.
const SKIP_BUSINESS_FIELDS_RESULTS = ["面談前", "連絡なし辞退", "連絡あり辞退", "支援終了_当社判断", "支援終了_本人希望"];

export function checkInputMissing(args: CheckInputMissingArgs): InputMissingResult {
  const missing: MissingFieldKey[] = [];
  const form = args.form ?? {};
  const detail = args.detail;
  const rating = args.rating;

  // resultFlag is always required — if it's missing the row is incomplete.
  const resultFlagRaw = (form as Record<string, unknown>).resultFlag;
  if (isStringEmpty(resultFlagRaw)) {
    missing.push("form.resultFlag");
  }

  // When resultFlag indicates the interview never happened, skip every
  // downstream business field check.
  if (typeof resultFlagRaw === "string" && SKIP_BUSINESS_FIELDS_RESULTS.includes(resultFlagRaw)) {
    return {
      hasMissing: missing.length > 0,
      missingFields: missing,
    };
  }

  // Group A
  if (isDateEmpty((form as Record<string, unknown>).interviewDate)) {
    missing.push("form.interviewDate");
  }
  for (const f of FORM_STRING_FIELDS) {
    if (f === "resultFlag") continue; // already handled above
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
    // nextAction / freeMemo / initialSummary: combined group — all three share
    // one textarea in the form, so only flag when all three are empty.
    const nextActionGroupAllEmpty =
      isStringEmpty(detail.nextAction) &&
      isStringEmpty(detail.freeMemo) &&
      isStringEmpty(detail.initialSummary);
    if (nextActionGroupAllEmpty) {
      missing.push("d.nextAction");
      missing.push("d.freeMemo");
      missing.push("d.initialSummary");
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
    missing.push("d.nextAction");
    missing.push("d.freeMemo");
    missing.push("d.initialSummary");
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

/**
 * Japanese labels for missing-field keys, used by the list-page hover tooltip
 * and the form's missing-summary popover.
 */
export const FIELD_LABELS: Record<string, string> = {
  // form (InterviewRecord)
  "form.interviewDate": "面談日",
  "form.startTime": "開始時間",
  "form.endTime": "終了時間",
  "form.interviewTool": "手法",
  "form.resultFlag": "結果",
  // detail — 転職活動状況
  "d.agentUsageFlag": "他AG状況",
  "d.jobChangeTimeline": "転職時期",
  "d.activityPeriod": "活動期間",
  "d.applicationTypeFlag": "他社応募",
  "d.currentApplicationCount": "現在応募数",
  "d.educationFlag": "最終学歴",
  "d.graduationDate": "卒業年月",
  "d.graduationStatus": "卒業状況",
  // detail — 希望条件
  "d.desiredJobTypes": "希望職種",
  "d.desiredIndustries": "希望業種",
  "d.desiredAreas": "希望エリア",
  "d.currentSalary": "現年収",
  "d.desiredSalaryMin": "希望年収(下限)",
  "d.desiredSalaryMax": "希望年収(上限)",
  "d.desiredDayOff": "希望休日",
  "d.desiredOvertimeMax": "希望残業",
  "d.desiredTransfer": "転勤可否",
  "d.driverLicenseFlag": "運転免許",
  "d.languageSkillFlag": "語学",
  "d.japaneseSkillFlag": "日本語",
  "d.typingFlag": "Typing",
  "d.excelFlag": "Excel",
  "d.wordFlag": "Word",
  "d.pptFlag": "PPT",
  // detail — アクション
  "d.documentStatusFlag": "書類状況",
  "d.documentSupportFlag": "サポート",
  "d.contactMethod": "連絡手段",
  "d.jobReferralFlag": "求人送付予定",
  "d.nextInterviewFlag": "次回面談予定",
  "d.nextInterviewDate": "次回面談日付",
  "d.nextInterviewTime": "次回面談時刻",
  "d.nextInterviewMemo": "次回面談メモ",
  "d.nextAction": "ネクストアクション",
  "d.freeMemo": "自由メモ",
  "d.initialSummary": "初期サマリ",
  // rating — 15 評価項目 (schema.prisma の field 名)
  "r.personalityMotivation": "転職意欲",
  "r.personalityCommunication": "コミュニケーション",
  "r.personalityManner": "ビジネスマナー",
  "r.personalityIntelligence": "地頭",
  "r.personalityHumanity": "人間性",
  "r.careerJobType": "希望職種(キャリア)",
  "r.careerExperience": "社会人経験",
  "r.careerJobChangeCount": "転職回数",
  "r.careerAchievement": "実績",
  "r.careerQualification": "語学・資格",
  "r.conditionJobType": "希望職種(条件)",
  "r.conditionSalary": "希望年収",
  "r.conditionHoliday": "休日・シフト",
  "r.conditionArea": "エリア",
  "r.conditionFlexibility": "柔軟性",
  // workHistories
  "workHistories.__empty__": "職歴",
};

export function getFieldLabel(key: MissingFieldKey): string {
  return FIELD_LABELS[key] ?? key;
}

/**
 * Deduplicate missing field labels (the nextAction/freeMemo/initialSummary
 * combined group emits 3 keys but represents a single UI textarea).
 */
export function getMissingFieldLabels(missingFields: MissingFieldKey[]): string[] {
  const labels = missingFields.map(getFieldLabel);
  return Array.from(new Set(labels));
}
