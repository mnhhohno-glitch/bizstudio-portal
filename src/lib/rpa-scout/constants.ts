// RPAスカウト管理の共通定数

export const SEND_STATUS_OPTIONS = [
  { value: "UNSENT", label: "未送信" },
  { value: "SENT", label: "送信済" },
] as const;

export const REGIST_DIRECTION_OPTIONS = [
  { value: "WITHIN", label: "以内" },
  { value: "AFTER", label: "以降" },
] as const;

export const EDUCATION_OPTIONS = [
  { value: "NONE", label: "学歴不問" },
  { value: "高卒", label: "高卒" },
  { value: "専門卒", label: "専門卒" },
  { value: "短大卒", label: "短大卒" },
  { value: "高専卒", label: "高専卒" },
  { value: "大卒", label: "大卒" },
  { value: "大学院卒", label: "大学院卒" },
] as const;

export const COMPANY_COUNT_OPTIONS = [1, 2, 3] as const;

export const WORK_LOCATION_PRIORITY_OPTIONS = [
  { value: "NONE", label: "エリア不順" },
  { value: "SECOND", label: "エリア第2" },
] as const;

export const JOB_CATEGORY_PRIORITY_OPTIONS = [
  { value: "FIRST", label: "職種第1" },
  { value: "SECOND", label: "職種第2" },
] as const;

export const TRANSFER_TIMING_OPTIONS = [
  "すぐにでも",
  "3カ月以内",
  "半年以内",
  "1年以内",
  "未定",
] as const;

export const TIME_SLOTS = [
  { value: "AM", label: "AM" },
  { value: "PM", label: "PM" },
  { value: "EVENING", label: "夕方" },
] as const;

export const TIME_SLOT_ORDER: Record<string, number> = { AM: 0, PM: 1, EVENING: 2 };

export function timeSlotLabel(slot: string): string {
  return TIME_SLOTS.find((s) => s.value === slot)?.label ?? slot;
}

export const MACHINE_NOS = [1, 2, 3, 4, 5, 6] as const;

// メールテンプレートの種別（Excelのテンプレートマスタの区分と対応）
export const TEMPLATE_KIND_OPTIONS = [
  { value: "UNSENT", label: "未送信用" },
  { value: "SENT", label: "送信済用" },
  { value: "INDIVIDUAL", label: "個別配信用" },
] as const;

export const TEMPLATE_KIND_VALUES = TEMPLATE_KIND_OPTIONS.map((o) => o.value) as readonly string[];

export function templateKindLabel(kind: string | null | undefined): string {
  if (!kind) return "未設定";
  return TEMPLATE_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? kind;
}

// 種別が付いていないテンプレート（移行前データ）をまとめるグループ名
export const TEMPLATE_KIND_OTHER_LABEL = "その他";

// 件名テンプレ選択のグループ並び順。選択中パターンの送信状態と一致する種別を先頭に出すだけで、
// 他の種別も同じプルダウンに残す（絞り込みはしない）
export function templateKindOrder(sendStatus: string | null | undefined): string[] {
  const base = TEMPLATE_KIND_OPTIONS.map((o) => o.value as string);
  if (!sendStatus || !base.includes(sendStatus)) return base;
  return [sendStatus, ...base.filter((k) => k !== sendStatus)];
}

// テンプレート本文の差し込みタグ。RPA（Power Automate Desktop）側で置換されるため表記を変えない
export const TEMPLATE_MERGE_TAGS = [
  { tag: "[社名]", desc: "求職者の在籍企業名（マイナビから取得して置換）" },
  { tag: "[最終学歴]", desc: "最終学歴（マイナビから取得して置換）" },
  { tag: "[経験職種]", desc: "経験職種（マイナビから取得して置換）" },
  { tag: "[担当者]", desc: "担当者名（Excelの設定シートの値に置換）" },
] as const;

// 画面に常時出すExcel貼り戻しの注意書き
export const TEMPLATE_EXCEL_NOTE =
  "テンプレートを変更した場合は、コピーして 05_集計ファイル.xlsx のテンプレートマスタ／メール設定に貼り替えてください。RPAはExcelを参照して配信します。";
