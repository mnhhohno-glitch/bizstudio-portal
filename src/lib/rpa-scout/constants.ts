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
