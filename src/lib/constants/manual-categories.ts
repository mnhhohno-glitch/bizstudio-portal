export interface ManualSubCategory {
  value: string;
  label: string;
}

export interface ManualCategoryGroup {
  value: string;
  label: string;
  subCategories: ManualSubCategory[];
}

export const MANUAL_CATEGORIES: ManualCategoryGroup[] = [
  {
    value: "INTERNAL",
    label: "社内",
    subCategories: [
      { value: "training", label: "研修・教育" },
      { value: "system_operation", label: "システム操作" },
      { value: "workflow", label: "業務フロー" },
      { value: "regulation", label: "規程・ルール" },
      { value: "template", label: "テンプレート" },
    ],
  },
  {
    value: "CANDIDATE",
    label: "求職者",
    subCategories: [
      { value: "candidate_flow", label: "対応フロー" },
      { value: "interview_prep", label: "面接対策" },
      { value: "document_creation", label: "書類作成" },
      { value: "trouble_response", label: "トラブル対応" },
    ],
  },
  {
    value: "CLIENT",
    label: "求人企業",
    subCategories: [
      { value: "sales_flow", label: "営業フロー" },
      { value: "job_management", label: "求人管理" },
      { value: "matching", label: "マッチング" },
      { value: "media_tools", label: "媒体・ツール" },
    ],
  },
];

export const getCategoryLabel = (value: string): string => {
  const category = MANUAL_CATEGORIES.find((c) => c.value === value);
  return category?.label || value;
};

export const getSubCategoryLabel = (
  categoryValue: string,
  subCategoryValue: string
): string => {
  const category = MANUAL_CATEGORIES.find((c) => c.value === categoryValue);
  const sub = category?.subCategories.find(
    (s) => s.value === subCategoryValue
  );
  return sub?.label || subCategoryValue;
};

export const getSubCategories = (
  categoryValue: string
): ManualSubCategory[] => {
  const category = MANUAL_CATEGORIES.find((c) => c.value === categoryValue);
  return category?.subCategories || [];
};
