export const EXCEL_TO_DETAIL_MAP: Record<string, string> = {
  "エージェント利用フラグ": "agentUsageFlag",
  "エージェント利用メモ": "agentUsageMemo",
  "転職時期フラグ": "jobChangeTimeline",
  "転職時期メモ": "jobChangeTimelineMemo",
  "転職活動期間フラグ": "activityPeriod",
  "転職活動期間メモ": "activityPeriodMemo",
  "現在応募求人数": "currentApplicationCount",
  "応募種別フラグ": "applicationTypeFlag",
  "応募状況メモ": "applicationMemo",
  "学歴フラグ": "educationFlag",
  "学歴メモ": "educationMemo",
  "卒業年月": "graduationDate",
  "希望職種フラグ": "desiredJobType1",
  "希望職種メモ": "desiredJobType1Memo",
  "希望業種フラグ": "desiredIndustry1",
  "希望業種メモ": "desiredIndustry1Memo",
  "希望エリアフラグ": "desiredArea",
  "希望都道府県": "desiredPrefecture",
  "希望市区": "desiredCity",
  "希望エリアメモ": "desiredAreaMemo",
  "現在年収": "currentSalary",
  "希望下限年収": "desiredSalaryMin",
  "希望年収": "desiredSalaryMax",
  "現年収メモ": "currentSalaryMemo",
  "下限年収メモ": "desiredSalaryMinMemo",
  "希望年収メモ": "desiredSalaryMaxMemo",
  "希望曜日フラグ": "desiredDayOff",
  "希望曜日メモ": "desiredDayOffMemo",
  "希望最大残業フラグ": "desiredOvertimeMax",
  "希望最大残業メモ": "desiredOvertimeMemo",
  "希望転勤フラグ": "desiredTransfer",
  "希望転勤メモ": "desiredTransferMemo",
  "自動車免許フラグ": "driverLicenseFlag",
  "自動車免許メモ": "driverLicenseMemo",
  "語学スキルメモ": "languageSkillMemo",
  "日本語スキルフラグ": "japaneseSkillFlag",
  "日本語スキ��メモ": "japaneseSkillMemo",
  "PCスキル_タイピングフラグ": "typingFlag",
  "PCスキル_タイピングメモ": "typingMemo",
  "PCスキル_Excelフラグ": "excelFlag",
  "PCスキル_Excelメモ": "excelMemo",
  "PCスキル_Wordフラグ": "wordFlag",
  "PCスキル_Wordメモ": "wordMemo",
  "PCスキル_PPTフラグ": "pptFlag",
  "PCスキル_PPTメモ": "pptMemo",
  "応募書類状況フラグ": "documentStatusFlag",
  "応募書類状況メモ": "documentStatusMemo",
  "応募書類サポートフラグ": "documentSupportFlag",
  "応募書類サポートメモ": "documentSupportMemo",
  "LINE設定フラグ": "lineSetupFlag",
  "LINE設定メモ": "lineSetupMemo",
  "求人送付フラグ": "jobReferralFlag",
  "求人送付予定時期": "jobReferralTimeline",
  "求人送付メモ": "jobReferralMemo",
  "次回面談設定フラグ": "nextInterviewFlag",
  "次回面談予定日": "nextInterviewDate",
  "次回面談予定時刻": "nextInterviewTime",
  "次回面談予定メモ": "nextInterviewMemo",
  "フリーメモ": "freeMemo",
  "初回面談まとめ": "initialSummary",
};

const LANGUAGE_SKILL_MAP: Record<string, string> = {
  "ネイティブレベル": "ネイティブ",
  "資格未取得_ネイティブレベル": "ネイティブ",
  "ビジネスレベル": "���ジネス",
  "日常会話レベル": "日常会話",
  "不可": "不可",
};

const INT_FIELDS = new Set(["currentApplicationCount", "currentSalary", "desiredSalaryMin", "desiredSalaryMax"]);

export function mapFilemakerToDetail(
  fmMapping: Record<string, unknown>,
): { detailUpdates: Record<string, unknown>; interviewMemo: string | null } {
  const result: Record<string, unknown> = {};
  let interviewMemo: string | null = null;

  for (const [excelKey, value] of Object.entries(fmMapping)) {
    if (value == null || String(value).trim() === "") continue;

    if (excelKey === "面談メモ") {
      interviewMemo = String(value);
      continue;
    }

    if (excelKey === "語学スキルフラグ") {
      const mapped = LANGUAGE_SKILL_MAP[String(value)];
      if (mapped) result.languageSkillFlag = mapped;
      continue;
    }

    if (excelKey === "語学フラグ") {
      const langType = String(value);
      if (langType && langType !== "不可") {
        const existing = result.languageSkillMemo ? String(result.languageSkillMemo) : "";
        result.languageSkillMemo = existing ? `${langType}。${existing}` : langType;
      }
      continue;
    }

    const portalField = EXCEL_TO_DETAIL_MAP[excelKey];
    if (!portalField) continue;

    if (INT_FIELDS.has(portalField)) {
      const num = Number(value);
      result[portalField] = isNaN(num) ? null : num;
    } else {
      result[portalField] = String(value);
    }
  }

  if (result.desiredJobType1) {
    const parts = String(result.desiredJobType1).split(" / ");
    result.desiredJobTypes = [{ large: parts[0] || "", medium: parts[1] || "", small: parts[2] || "" }];
  }
  if (result.desiredIndustry1) {
    const parts = String(result.desiredIndustry1).split(" / ");
    result.desiredIndustries = [{ large: parts[0] || "", medium: parts[1] || "", small: parts[2] || "" }];
  }
  if (result.desiredArea || result.desiredPrefecture) {
    result.desiredAreas = [{ area: result.desiredArea || "", prefecture: result.desiredPrefecture || "", city: result.desiredCity || "" }];
  }

  return { detailUpdates: result, interviewMemo };
}

export interface WorkHistoryInput {
  order: number;
  companyName: string | null;
  businessContent: string | null;
  tenureYear: number | null;
  tenureMonth: number | null;
  jobTypeFlag: string | null;
  jobTypeMemo: string | null;
  resignReasonLarge: string | null;
  resignReasonMedium: string | null;
  resignReasonSmall: string | null;
  jobChangeReasonMemo: string | null;
  hireDate: string | null;
  leaveDate: string | null;
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function toInt(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : Math.round(n);
}

export function mapWorkHistoryArray(rawHistory: Record<string, unknown>[]): WorkHistoryInput[] {
  const mapped = rawHistory
    .map((w, i) => ({
      order: toInt(w["何社目"]) ?? i + 1,
      companyName: toStr(w["企業名"]),
      businessContent: toStr(w["事業内容"]),
      tenureYear: toInt(w["在籍期間_年"]),
      tenureMonth: toInt(w["在籍期間_ヶ月"]),
      jobTypeFlag: toStr(w["職種フラグ"]),
      jobTypeMemo: toStr(w["職種メモ"]),
      resignReasonLarge: toStr(w["退職理由_大"]),
      resignReasonMedium: toStr(w["退職理由_中"]),
      resignReasonSmall: toStr(w["退職理由_小"]),
      jobChangeReasonMemo: toStr(w["転職理由メモ"]),
      hireDate: toStr(w["入社年月"]),
      leaveDate: toStr(w["退職年月"]),
    }))
    .sort((a, b) => a.order - b.order);
  const merged = mergeSameCompany(mapped);
  const analysisDate = new Date();
  return merged.map((r) => applyCalculatedTenure(r, analysisDate));
}

function parseYearMonth(str: string): { year: number; month: number } | null {
  const match = str.match(/(\d{4})[-年\/.](\d{1,2})/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function calculateTenureFromDates(
  hireDate: string | null | undefined,
  leaveDate: string | null | undefined,
  analysisDate: Date,
): { years: number; months: number } | null {
  if (!hireDate || hireDate.trim() === "") return null;
  const hire = parseYearMonth(hireDate);
  if (!hire) return null;

  let leave: { year: number; month: number };
  if (!leaveDate || leaveDate.trim() === "") {
    leave = { year: analysisDate.getFullYear(), month: analysisDate.getMonth() + 1 };
  } else {
    const parsed = parseYearMonth(leaveDate);
    if (!parsed) return null;
    leave = parsed;
  }

  const diff = (leave.year * 12 + leave.month) - (hire.year * 12 + hire.month);
  if (diff < 0 || diff > 600) return null;
  return { years: Math.floor(diff / 12), months: diff % 12 };
}

function applyCalculatedTenure(
  record: WorkHistoryInput,
  analysisDate: Date,
): WorkHistoryInput {
  const calculated = calculateTenureFromDates(record.hireDate, record.leaveDate, analysisDate);
  if (!calculated) return record;
  return { ...record, tenureYear: calculated.years, tenureMonth: calculated.months };
}

function extractBaseCompanyName(name: string | null): string {
  if (!name) return "";
  return name
    .replace(/[（(][^)）]*[)）]/g, "")
    .replace(/[\s　]+/g, "")
    .trim();
}

function mergeSameCompany(records: WorkHistoryInput[]): WorkHistoryInput[] {
  const groups = new Map<string, WorkHistoryInput[]>();
  const order: string[] = [];

  for (const r of records) {
    const base = extractBaseCompanyName(r.companyName);
    if (!base) {
      const key = `__unmatched_${groups.size}`;
      groups.set(key, [r]);
      order.push(key);
      continue;
    }
    if (!groups.has(base)) {
      groups.set(base, []);
      order.push(base);
    }
    groups.get(base)!.push(r);
  }

  const merged: WorkHistoryInput[] = [];
  for (const key of order) {
    const recs = groups.get(key)!;
    if (recs.length === 1) {
      merged.push(recs[0]);
      continue;
    }
    const sorted = [...recs].sort((a, b) => a.order - b.order);
    const totalMonths = sorted.reduce((sum, r) => {
      return sum + (r.tenureYear ?? 0) * 12 + (r.tenureMonth ?? 0);
    }, 0);
    const memos = sorted.map((r) => r.jobTypeMemo).filter(Boolean);
    const last = sorted[sorted.length - 1];
    merged.push({
      ...sorted[0],
      tenureYear: Math.floor(totalMonths / 12),
      tenureMonth: totalMonths % 12,
      jobTypeMemo: memos.length > 0 ? memos.join(" / ") : sorted[0].jobTypeMemo,
      resignReasonLarge: last.resignReasonLarge,
      resignReasonMedium: last.resignReasonMedium,
      resignReasonSmall: last.resignReasonSmall,
      jobChangeReasonMemo: last.jobChangeReasonMemo,
      hireDate: sorted.map((r) => r.hireDate).filter((h) => h && h.trim() !== "").sort()[0] ?? null,
      leaveDate: sorted.some((r) => !r.leaveDate || r.leaveDate.trim() === "")
        ? null
        : sorted.map((r) => r.leaveDate).filter((l) => l).sort().reverse()[0] ?? null,
    });
  }

  return merged.map((r, i) => ({ ...r, order: i + 1 }));
}

export function workHistoryToDetailSync(histories: WorkHistoryInput[]): Record<string, unknown> {
  if (histories.length === 0) return {};
  const latest = [...histories].sort((a, b) => a.order - b.order)[0];
  const tenure = [
    latest.tenureYear != null ? `${latest.tenureYear}年` : null,
    latest.tenureMonth != null ? `${latest.tenureMonth}ヶ月` : null,
  ].filter(Boolean).join("");
  return {
    companyName: latest.companyName,
    businessContent: latest.businessContent,
    tenure: tenure || null,
    jobTypeFlag: latest.jobTypeFlag,
    jobTypeMemo: latest.jobTypeMemo,
    resignReasonLarge: latest.resignReasonLarge,
    resignReasonMedium: latest.resignReasonMedium,
    resignReasonSmall: latest.resignReasonSmall,
    jobChangeReasonMemo: latest.jobChangeReasonMemo,
    careerSummary: histories
      .map((w) => {
        const t = [
          w.tenureYear != null ? `${w.tenureYear}年` : null,
          w.tenureMonth != null ? `${w.tenureMonth}ヶ月` : null,
        ].filter(Boolean).join("");
        return `【${w.order}社目】${w.companyName ?? ""}（${w.businessContent ?? ""}）${t} / ${w.jobTypeFlag ?? ""}`;
      })
      .join("\n"),
  };
}
