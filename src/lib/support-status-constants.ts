export const SUPPORT_STATUS_VALUES = ["BEFORE", "ACTIVE", "WAITING", "ENDED"] as const;
export type SupportStatus = (typeof SUPPORT_STATUS_VALUES)[number];

export const SUPPORT_STATUS_LABEL: Record<string, string> = {
  BEFORE: "支援前",
  ACTIVE: "支援中",
  WAITING: "待機",
  ENDED: "支援終了",
};

export const SUPPORT_SUB_STATUS_MAP: Record<string, string[]> = {
  BEFORE: ["面談前"],
  ACTIVE: ["求人紹介前", "BM", "求人紹介", "エントリー", "書類選考", "面接", "内定", "入社済"],
  WAITING: ["待機"],
  ENDED: ["当社判断", "本人希望"],
};

export const SUPPORT_SUB_STATUS_DEFAULT: Record<string, string> = {
  BEFORE: "面談前",
  ACTIVE: "求人紹介前",
  WAITING: "待機",
  ENDED: "当社判断",
};

// 大項目が変更不可（= 中項目が1択）のケース
export function isSubStatusFixed(supportStatus: string): boolean {
  return supportStatus === "BEFORE" || supportStatus === "WAITING";
}
