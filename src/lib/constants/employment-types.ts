export const EMPLOYMENT_TYPES = [
  "正社員",
  "契約社員",
  "派遣社員",
  "パート・アルバイト",
  "業務委託",
  "その他",
] as const;

export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
