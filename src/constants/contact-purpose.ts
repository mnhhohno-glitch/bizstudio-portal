// T-111: 次回連絡予定の「目的」選択肢。candidate-flags.ts とは独立（変更禁止ファイルに触れない）。
export const CONTACT_PURPOSES = [
  "状況確認",
  "書類提出依頼",
  "日程調整",
  "求人紹介",
  "選考結果連絡",
  "内定承諾確認",
  "その他",
] as const;

export type ContactPurpose = (typeof CONTACT_PURPOSES)[number];
