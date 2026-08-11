// RPAスカウト管理のクライアント側共有型・表示ヘルパー
import { addDaysYmd, nowJstYmd } from "@/lib/rpa-scout/jst";

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
  // 最終使用（全号機横断。patternId紐付け優先＋パターン名フォールバック）
  lastUsedAt: string | null; // JST壁時計値
  lastUsedMachineNo: number | null;
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
  expectedCount: number | null; // 想定検索件数（任意入力）
  reflectedAt: string | null; // JST壁時計値
  reflectedByUserId: string | null;
  reflectedByName?: string | null;
  executedAt: string | null; // 実績記録済みなら記録日時（JST壁時計値）。null=未実施
  executedLogId: string | null;
  executedByUserId: string | null;
  executedByName?: string | null;
  executedSearchCount?: number | null; // 生成した RpaScoutLog の検索件数（null=停止記録）
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

// JST壁時計値 → "HH:mm"
export function fmtJstTime(s: string): string {
  return s.slice(11, 16);
}

// 真のUTC instant（createdAt等）→ JST日付表示
export function fmtUtcInstantAsJstDate(s: string): string {
  return new Date(s).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

// JST壁時計値 → "M/D HH:mm"（最終使用の表示用）
export function fmtJstShortDateTime(s: string): string {
  const [, m, d] = fmtJstDate(s).split("-");
  return `${Number(m)}/${Number(d)} ${fmtJstTime(s)}`;
}

// 最終使用が3日以内か（JSTのymd文字列比較で判定＝罠#17対応）
export function isRecentlyUsed(lastUsedAt: string | null): boolean {
  if (!lastUsedAt) return false;
  return fmtJstDate(lastUsedAt) >= addDaysYmd(nowJstYmd(), -3);
}

// パターン選択肢の末尾に付ける最終使用の表記
export function lastUsedSuffix(p: {
  lastUsedAt: string | null;
  lastUsedMachineNo: number | null;
}): string {
  if (!p.lastUsedAt) return "（未使用）";
  const machine = p.lastUsedMachineNo != null ? ` ${p.lastUsedMachineNo}号機` : "";
  return `（最終: ${fmtJstShortDateTime(p.lastUsedAt)}${machine}）`;
}
