// RPAスカウト管理のクライアント側共有型・表示ヘルパー

export type RpaLog = {
  id: string;
  machineNo: number;
  patternId: string | null;
  patternName: string;
  subjectTemplateId: string | null;
  subjectName: string;
  searchCount: number | null;
  recordedAt: string; // JST壁時計値（"....Z" 形式で流れてくるがUTC変換せず slice で表示する）
  recordedByUserId: string | null;
  recordedByName?: string | null;
};

export type RpaMachine = {
  id: string;
  machineNo: number;
  accountName: string;
  employeeCode: string;
  mynaviSaveName: string;
  isActive: boolean;
  latestLog: RpaLog | null;
};

export type RpaPattern = {
  id: string;
  targetMachineNo: number | null;
  name: string;
  sendStatus: string | null;
  registDays: number | null;
  registDirection: string | null;
  lastLoginDays: number | null;
  areaType: string | null;
  prefectures: string[] | null;
  education: string | null;
  gradYearFrom: number | null;
  gradYearTo: number | null;
  companyCount: number | null;
  jobCategories: string[] | null;
  jobCategoryPriority: string | null;
  workLocations: string[] | null;
  workLocationPriority: string | null;
  transferTiming: string | null;
  rawConditions: Record<string, string> | null;
  isActive: boolean;
  isMigrated: boolean;
  createdAt: string;
};

export type RpaTemplate = {
  id: string;
  name: string;
  subject: string;
  isActive: boolean;
};

export type RpaPlan = {
  id: string;
  planDate: string; // JST壁時計値
  timeSlot: string; // "AM" | "PM" | "EVENING"
  machineNo: number;
  patternId: string | null;
  patternName: string;
  subjectTemplateId: string | null;
  subjectName: string;
  memo: string | null;
  reflectedAt: string | null; // JST壁時計値
  reflectedByUserId: string | null;
  reflectedByName?: string | null;
  createdByUserId: string | null;
  createdByName?: string | null;
};

export type JobCategoryRow = { large: string; middle: string; small: string };

// JST壁時計値のISO風文字列 → "YYYY-MM-DD HH:mm"（Dateを介さず文字列のまま表示。罠#17）
export function fmtJstDateTime(s: string): string {
  return s.slice(0, 16).replace("T", " ");
}

// JST壁時計値 → "YYYY-MM-DD"
export function fmtJstDate(s: string): string {
  return s.slice(0, 10);
}

// 真のUTC instant（createdAt等）→ JST日付表示
export function fmtUtcInstantAsJstDate(s: string): string {
  return new Date(s).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}
