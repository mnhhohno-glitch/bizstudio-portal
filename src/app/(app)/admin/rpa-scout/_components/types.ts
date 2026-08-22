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
  // 配信計画から記録された実績なら元計画。null=状況ボードからの直接記録／移行データ
  sourcePlan?: {
    id: string;
    planDate: string; // JST壁時計値
    timeSlot: string;
    expectedCount: number | null;
    memo: string | null;
  } | null;
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
  kind: string | null; // UNSENT / SENT / INDIVIDUAL。移行前データはnull
  subject: string;
  body: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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

// その号機に「現在」設定されている件名テンプレのid（最新ログ基準＝状況ボードのカード表示と同じ）。
// subjectTemplateId を優先し、無い場合（移行データ）はテンプレ名で照合する。特定できなければ null
export function currentSubjectTemplateId(
  machine: RpaMachine | null | undefined,
  templates: RpaTemplate[]
): string | null {
  const log = machine?.latestLog;
  if (!log) return null;
  if (log.subjectTemplateId) return log.subjectTemplateId;
  const name = (log.subjectName ?? "").trim();
  if (!name) return null;
  return templates.find((t) => t.isActive && t.name.trim() === name)?.id ?? null;
}

// 配信Excel（05_集計ファイル.xlsx のテンプレートマスタ B2:B5）に貼る用のテキスト。
// 1〜4号機の現在の件名テンプレ名を号機順に改行区切りで返す。
// 記録が無い号機は空行にして行位置（＝Excelの号機）をずらさない。末尾に改行は付けない
export const EXCEL_SUBJECT_MACHINE_NOS = [1, 2, 3, 4] as const;

export function buildExcelSubjectText(machines: RpaMachine[]): string {
  return EXCEL_SUBJECT_MACHINE_NOS.map((no) => {
    const m = machines.find((x) => x.machineNo === no);
    return m?.latestLog?.subjectName?.trim() ?? "";
  }).join("\n");
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

// 実績ログの記録者表示。計画由来なのに記録者が空＝外部API（RPA）が書き戻した実績。
// 計画に紐づかない記録者なしは移行データなので、従来どおり氏名なし扱い（null）。
export function recordedByLabel(
  log: Pick<RpaLog, "recordedByName" | "sourcePlan">
): string | null {
  if (log.recordedByName) return log.recordedByName;
  return log.sourcePlan ? "RPA自動" : null;
}
