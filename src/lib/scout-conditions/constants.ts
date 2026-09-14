// T-194: スカウト配信条件コンソールの共通定数（画面・API・シードで共用する単一ソース）
// 検索軸の定義は「スカウト検索条件_新方式_検索軸仕様_2026-09-13.md」に従う。

import {
  ALL_AREA_GROUPS,
  EAST_AREA_GROUPS,
  WEST_AREA_GROUPS,
  ALL_PREFECTURES,
  type AreaGroup,
} from "@/lib/rpa-scout/area";

export { ALL_AREA_GROUPS, EAST_AREA_GROUPS, WEST_AREA_GROUPS, ALL_PREFECTURES };
export type { AreaGroup };

// ---- 状態 ----
export const CONDITION_STATUSES = [
  { value: "RUNNING", label: "実行中" },
  { value: "QUEUED", label: "予約" },
  { value: "DRY", label: "枯渇" },
  { value: "DONE", label: "完了" },
] as const;
export type ConditionStatus = (typeof CONDITION_STATUSES)[number]["value"];
export const CONDITION_STATUS_VALUES: readonly string[] = CONDITION_STATUSES.map((s) => s.value);
export function conditionStatusLabel(v: string): string {
  return CONDITION_STATUSES.find((s) => s.value === v)?.label ?? v;
}

// ---- 1. 検索対象（自社がスカウトを送信した会員の扱い） ----
export const SEARCH_TARGETS = [
  { value: "EXCLUDE", label: "含まない", sub: "未送信" },
  { value: "ONLY", label: "のみ", sub: "送信済" },
  { value: "INCLUDE", label: "含む", sub: "" },
] as const;
export type SearchTarget = (typeof SEARCH_TARGETS)[number]["value"];
export const SEARCH_TARGET_VALUES: readonly string[] = SEARCH_TARGETS.map((s) => s.value);
export function searchTargetLabel(v: string): string {
  const t = SEARCH_TARGETS.find((s) => s.value === v);
  if (!t) return v;
  return t.sub ? `${t.label}（${t.sub}）` : t.label;
}

// ---- 2. 登録日 ----
export const REGIST_DATE_MODES = [
  { value: "PERIOD", label: "期間指定" },
  { value: "DATE", label: "日付入力" },
] as const;
export type RegistDateMode = (typeof REGIST_DATE_MODES)[number]["value"];
export const REGIST_DATE_MODE_VALUES: readonly string[] = REGIST_DATE_MODES.map((s) => s.value);

// 期間指定の選択肢（マイナビのプルダウン。運用の中心は 1・3・7）
export const PERIOD_DAYS_OPTIONS = [1, 3, 7, 14, 30, 60, 90, 180, 360] as const;
export function periodDaysLabel(days: number | null | undefined): string {
  return days == null ? "指定なし" : `${days}日以内`;
}

// ---- 3. 最終ログイン日（期間指定のみ・初期値 1日以内） ----
export const DEFAULT_LAST_LOGIN_DAYS = 1;

// ---- 4. 卒業年度 ----
export const GRAD_YEAR_MIN = 1980;
export function gradYearOptions(currentYear: number): number[] {
  const max = currentYear + 4;
  const out: number[] = [];
  for (let y = max; y >= GRAD_YEAR_MIN; y--) out.push(y);
  return out;
}
export function gradYearRangeLabel(from: number | null, to: number | null): string {
  if (from == null && to == null) return "指定なし";
  const f = from == null ? "" : String(from).slice(2);
  const t = to == null ? "" : String(to).slice(2);
  return `${f}-${t}`;
}

// ---- 5. 経験社数（null=-- / 0=0社 / 1〜6=～N社 / 7=7社以上。「0社を除く」は常にチェックなし） ----
export const COMPANY_COUNT_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "--" },
  { value: 0, label: "0社" },
  { value: 1, label: "～1社" },
  { value: 2, label: "～2社" },
  { value: 3, label: "～3社" },
  { value: 4, label: "～4社" },
  { value: 5, label: "～5社" },
  { value: 6, label: "～6社" },
  { value: 7, label: "7社以上" },
];
export function companyCountLabel(v: number | null | undefined): string {
  return COMPANY_COUNT_OPTIONS.find((o) => o.value === (v ?? null))?.label ?? String(v);
}

// ---- 6. 居住地（T-196: T-194/195 で「希望勤務地」として作った軸は実際には居住地だった） ----
export const AREA_MODES = [
  { value: "NATIONWIDE", label: "全国" },
  { value: "EAST", label: "東日本" },
  { value: "WEST", label: "西日本" },
  { value: "PREFECTURE", label: "都道府県指定" },
] as const;
export type AreaMode = (typeof AREA_MODES)[number]["value"];
export const AREA_MODE_VALUES: readonly string[] = AREA_MODES.map((s) => s.value);
export const AREA_CHIP_MODES = AREA_MODES.filter((m) => m.value !== "PREFECTURE");

const EAST_REGIONS = new Set(EAST_AREA_GROUPS.map((g) => g.region));
const WEST_REGIONS = new Set(WEST_AREA_GROUPS.map((g) => g.region));

/**
 * 都道府県配列を地域単位にまとめた表示文字列。
 * 全地域が揃えば「全国」、東日本4地域が揃えば「東日本」、西日本6地域が揃えば「西日本」。
 * 地域が全選択なら地域名（例「関東」）、一部なら県名を「/」区切りで並べる。地域同士は「・」で結ぶ。
 */
export function summarizePrefectures(prefectures: string[]): string {
  const set = new Set(prefectures);
  if (set.size === 0) return "未選択";
  const fullRegions = new Set<string>();
  const parts: string[] = [];
  for (const g of ALL_AREA_GROUPS) {
    const picked = g.prefectures.filter((p) => set.has(p));
    if (picked.length === 0) continue;
    if (picked.length === g.prefectures.length) {
      fullRegions.add(g.region);
      parts.push(g.region);
    } else {
      parts.push(picked.join("/"));
    }
  }
  const eastFull = [...EAST_REGIONS].every((r) => fullRegions.has(r));
  const westFull = [...WEST_REGIONS].every((r) => fullRegions.has(r));
  if (eastFull && westFull && parts.length === fullRegions.size) return "全国";
  if (eastFull && parts.length === EAST_REGIONS.size) return "東日本";
  if (westFull && parts.length === WEST_REGIONS.size) return "西日本";
  if (eastFull) return ["東日本", ...parts.filter((p) => !EAST_REGIONS.has(p))].join("・");
  if (westFull) return [...parts.filter((p) => !WEST_REGIONS.has(p)), "西日本"].join("・");
  return parts.join("・");
}

export function areaLabel(mode: string, prefectures: string[]): string {
  if (mode === "PREFECTURE") return summarizePrefectures(prefectures);
  return AREA_MODES.find((m) => m.value === mode)?.label ?? mode;
}

// ---- 7. 希望勤務地（T-196） ----
// ALL=指定しない（マイナビ上は「全国」を入れる。空欄にはしない） / SELECTED=workPrefectures の都道府県を指定
export const WORK_PREF_MODES = [
  { value: "ALL", label: "指定なし（全国）" },
  { value: "SELECTED", label: "都道府県指定" },
] as const;
export type WorkPrefMode = (typeof WORK_PREF_MODES)[number]["value"];
export const WORK_PREF_MODE_VALUES: readonly string[] = WORK_PREF_MODES.map((s) => s.value);

/** 有効エリア8都府県（新規作成時の初期値。表記は ALL_PREFECTURES と同じ短縮形・定義順） */
export const DEFAULT_WORK_PREFECTURES: string[] = ALL_PREFECTURES.filter((p) =>
  ["東京", "埼玉", "神奈川", "千葉", "愛知", "大阪", "兵庫", "京都"].includes(p),
);
export const DEFAULT_WORK_PREFECTURES_LABEL = "有効エリア";

/** 有効エリア8都府県ちょうど（順不同）か */
export function isDefaultWorkPrefectures(prefectures: string[]): boolean {
  if (prefectures.length !== DEFAULT_WORK_PREFECTURES.length) return false;
  const set = new Set(prefectures);
  return DEFAULT_WORK_PREFECTURES.every((p) => set.has(p));
}

/** 一覧・CSV 用の短い表示。「指定なし（全国）」／「有効エリア」／「N都道府県」 */
export function workPrefLabel(mode: string | null | undefined, prefectures: string[]): string {
  if (mode === "ALL") return WORK_PREF_MODES[0].label;
  if (isDefaultWorkPrefectures(prefectures)) return DEFAULT_WORK_PREFECTURES_LABEL;
  if (prefectures.length === 0) return "未選択";
  return `${prefectures.length}都道府県`;
}

/** 条件のエリア指定を都道府県の集合に展開する（絞り込みの重なり判定用） */
export function expandAreaToPrefectures(mode: string, prefectures: string[]): string[] {
  if (mode === "NATIONWIDE") return ALL_PREFECTURES;
  if (mode === "EAST") return EAST_AREA_GROUPS.flatMap((g) => g.prefectures);
  if (mode === "WEST") return WEST_AREA_GROUPS.flatMap((g) => g.prefectures);
  return prefectures;
}

// ---- 配信テンプレート ----
export const TEMPLATE_KINDS = [
  { value: "UNSENT", label: "未送信用" },
  { value: "SENT", label: "送信済用" },
  { value: "INDIVIDUAL", label: "個別配信用" },
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number]["value"];
export const TEMPLATE_KIND_VALUES: readonly string[] = TEMPLATE_KINDS.map((s) => s.value);
export function templateKindLabel(v: string | null | undefined): string {
  if (!v) return "未設定";
  return TEMPLATE_KINDS.find((s) => s.value === v)?.label ?? v;
}

// 差し込み項目（RPA 側で置換するため表記を変えない）。色分け表示のための色も1か所で持つ
export const MERGE_TAGS = [
  { tag: "[担当者]", className: "bg-[#DBEAFE] text-[#1D4ED8]" },
  { tag: "[社名]", className: "bg-[#FEF3C7] text-[#B45309]" },
  { tag: "[最終学歴]", className: "bg-[#DCFCE7] text-[#15803D]" },
  { tag: "[経験職種]", className: "bg-[#F3E8FF] text-[#7E22CE]" },
] as const;
export const MERGE_TAG_RE = /(\[担当者\]|\[社名\]|\[最終学歴\]|\[経験職種\])/g;

// ---- 固定値（スキーマに持たせない。RPA が常にこの値を入力する） ----
export const FIXED_VALUES = [
  { label: "学歴", value: "不問（チェックを入れない）" },
  { label: "経験職種", value: "指定なし" },
  { label: "0社を除く", value: "チェックなし" },
  { label: "除外リストの会員", value: "含まない" },
  { label: "自社へ応募した会員", value: "含まない" },
] as const;

// ---- レコード番号（T-197）: 号機番号-3桁ゼロ埋めの通し番号。例 1-001 ----
export function formatRecordNo(machineNo: number, seqNo: number | null | undefined): string | null {
  if (seqNo == null) return null;
  return `${machineNo}-${String(seqNo).padStart(3, "0")}`;
}

// ---- 枯渇判定：送信件数が10件未満 ----
export const DRY_THRESHOLD = 10;
export function isDrySentCount(sentCount: number | null | undefined): boolean {
  return sentCount != null && sentCount < DRY_THRESHOLD;
}

// ---- 号機の色（画面表示専用。号機↔担当者の対応は recruiterDisplay.ts の RC_ROSTER に一本化） ----
export const MACHINE_COLORS: Record<number, { chip: string; dot: string }> = {
  1: { chip: "border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]", dot: "bg-[#2563EB]" },
  2: { chip: "border-[#059669] bg-[#ECFDF5] text-[#047857]", dot: "bg-[#059669]" },
  3: { chip: "border-[#D97706] bg-[#FFFBEB] text-[#B45309]", dot: "bg-[#D97706]" },
  4: { chip: "border-[#7C3AED] bg-[#F5F3FF] text-[#6D28D9]", dot: "bg-[#7C3AED]" },
  5: { chip: "border-[#DB2777] bg-[#FDF2F8] text-[#BE185D]", dot: "bg-[#DB2777]" },
  6: { chip: "border-[#6B7280] bg-[#F9FAFB] text-[#4B5563]", dot: "bg-[#6B7280]" },
};
export function machineColor(no: number) {
  return MACHINE_COLORS[no] ?? MACHINE_COLORS[6];
}

// ---- 並び順 ----
export const SORT_OPTIONS = [
  { value: "machine", label: "号機順" },
  { value: "sentAsc", label: "送信件数が少ない順" },
  { value: "plannedDesc", label: "予定件数が多い順" },
  { value: "executedDesc", label: "実行日が新しい順" },
] as const;
export type SortKey = (typeof SORT_OPTIONS)[number]["value"];
