export interface FileCategory {
  value: string;
  label: string;
  description: string;
}

export const CANDIDATE_FILE_CATEGORIES: FileCategory[] = [
  { value: "ORIGINAL", label: "原本", description: "履歴書フォーマット、本人提出の原本書類、顔写真" },
  { value: "JOB_POSTING", label: "求人", description: "紹介した求人のPDFデータ" },
  { value: "BS_DOCUMENT", label: "BS作成書類", description: "当社作成の履歴書・職務経歴書・推薦書" },
  { value: "APPLICATION", label: "応募企業", description: "応募先企業の関連資料" },
  { value: "INTERVIEW_PREP", label: "面接対策", description: "面接対策で使用したファイル" },
  { value: "MEETING", label: "面談", description: "面談ログ、マイナビからのDL資料" },
];

export const getCategoryLabel = (value: string): string => {
  const cat = CANDIDATE_FILE_CATEGORIES.find((c) => c.value === value);
  return cat?.label || value;
};
