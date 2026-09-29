// T-208 step2: 欄のパス（"d.xxx" / "wh.<n>.xxx" / "ws.<項目>"）→ 画面の名前。台本モードの「入力内容」タブと提案の表示に使う。

const DETAIL_LABELS: Record<string, string> = {
  agentUsageFlag: "他AG状況",
  agentUsageMemo: "他AG状況のメモ",
  employmentStatus: "在職状況",
  resignationDate: "退職日",
  jobChangeTimeline: "転職時期",
  jobChangeTimelineMemo: "転職時期のメモ",
  activityPeriod: "活動期間",
  activityPeriodMemo: "活動期間のメモ",
  applicationTypeFlag: "他社応募",
  applicationMemo: "他社応募のメモ",
  currentApplicationCount: "応募社数",
  educationMemo: "最終学歴（学校名）",
  graduationDate: "卒業年月",
  desiredJobType1Memo: "職種のメモ",
  desiredIndustry1Memo: "業種のメモ",
  desiredAreaMemo: "エリアのメモ",
  currentSalary: "現年収",
  currentSalaryMemo: "現年収のメモ",
  desiredSalaryMin: "希望下限",
  desiredSalaryMinMemo: "希望下限のメモ",
  desiredSalaryMax: "希望年収",
  desiredSalaryMaxMemo: "希望年収のメモ",
  desiredDayOff: "希望休日",
  desiredHolidayCount: "年間休日",
  desiredOvertimeMax: "希望残業",
  desiredOvertimeMemo: "希望残業のメモ",
  desiredTransfer: "転勤有無",
  desiredTransferMemo: "転勤のメモ",
  driverLicenseFlag: "自動車免許",
  driverLicenseMemo: "自動車免許のメモ",
  languageSkillFlag: "語学",
  languageSkillMemo: "語学のメモ",
  japaneseSkillFlag: "日本語",
  typingFlag: "Typing",
  excelFlag: "Excel",
  wordFlag: "Word",
  pptFlag: "PPT",
  priorityCondition1: "大事にしたい条件1",
  priorityCondition2: "大事にしたい条件2",
  priorityCondition3: "大事にしたい条件3",
  documentStatusFlag: "書類状況",
  documentStatusMemo: "書類状況のメモ",
  contactMethod: "連絡手段",
  nextInterviewFlag: "次回面談",
  nextInterviewDate: "次回面談の日付",
  nextInterviewTime: "次回面談の時刻",
  nextInterviewMemo: "次回面談メモ",
};

const WH_LABELS: Record<string, string> = {
  jobTypeMemo: "職種の詳細",
  resignReasonLarge: "退社理由（大）",
  resignReasonMedium: "退社理由（中）",
  resignReasonSmall: "退社理由（小）",
  jobChangeReasonMemo: "退社理由の詳細",
  companyName: "企業名",
};

export function fieldLabelOf(path: string): string {
  const p = path.split("@")[0];
  if (p.startsWith("d.")) return DETAIL_LABELS[p.slice(2)] ?? p.slice(2);
  if (p.startsWith("wh.")) {
    const [, idx, field] = p.split(".");
    return `${Number(idx) + 1}社目 ${WH_LABELS[field] ?? field}`;
  }
  if (p.startsWith("ws.")) return `働き方「${p.slice(3)}」`;
  return p;
}
