export const SUPPORT_END_REASONS = [
  // エントリー由来（自動セット）
  { code: "HIRED", label: "入社決定", auto: true },
  { code: "OFFER_DECLINED_OTHER", label: "内定辞退（他社決定）", auto: true },
  { code: "OFFER_DECLINED_SELF", label: "内定辞退（自社他）", auto: true },
  { code: "WITHDREW_DURING_SELECTION", label: "選考中辞退", auto: true },
  { code: "REJECTED_ALL", label: "選考落ち", auto: true },
  // 手動選択
  { code: "OTHER_COMPANY_BEFORE_ENTRY", label: "他社決定（エントリー前）", auto: false },
  { code: "ACTIVITY_STOPPED", label: "転職活動中止", auto: false },
  { code: "NO_MATCHING_JOBS", label: "希望条件不一致", auto: false },
  { code: "NO_CONTACT", label: "連絡不通", auto: false },
  { code: "NOT_ELIGIBLE", label: "紹介対象外", auto: false },
  { code: "NO_CONTACT_AFTER_APPLICATION", label: "応募後音信不通", auto: false },
  { code: "MEETING_SETUP_DECLINED", label: "面談設定辞退", auto: false },
  { code: "NO_CONTACT_AFTER_MEETING", label: "面談後連絡不通", auto: false },
  { code: "OTHER", label: "その他（自由記述）", auto: false },
] as const;

export const REASON_LABEL_MAP = Object.fromEntries(
  SUPPORT_END_REASONS.map((r) => [r.code, r.label])
) as Record<string, string>;
