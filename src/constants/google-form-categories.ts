/**
 * T-029 Phase D-2: Google Form 自動生成で使用する 21 サブカテゴリ
 *
 * このファイルは candidate-intake 側の specs/generate_form_prompt.yaml の
 * subcategories 定義と内容を同期する必要がある。
 * candidate-intake 側を更新したら portal 側も同期更新すること。
 *
 * 関連ファイル:
 * - candidate-intake: specs/generate_form_prompt.yaml
 * - portal: src/components/candidates/GoogleFormCreatorModal.tsx
 */

export type GoogleFormCategoryOption = {
  value: string; // candidate-intake API に渡す値（例: "sales_corporate"）
  label: string; // UI 表示ラベル（例: "法人営業"）
};

export type GoogleFormCategoryGroup = {
  label: string; // 大項目ラベル（例: "営業職"）
  options: GoogleFormCategoryOption[];
};

export const GOOGLE_FORM_CATEGORY_GROUPS: GoogleFormCategoryGroup[] = [
  {
    label: "営業職",
    options: [
      { value: "sales_corporate", label: "法人営業" },
      { value: "sales_personal", label: "個人営業" },
    ],
  },
  {
    label: "事務職",
    options: [
      { value: "office_sales", label: "営業事務" },
      { value: "office_general", label: "総務事務" },
      { value: "office_accounting", label: "経理事務" },
      { value: "office_hr", label: "人事" },
      { value: "office_other", label: "その他事務" },
    ],
  },
  {
    label: "企画・管理",
    options: [
      { value: "planning_marketing", label: "マーケティング" },
      { value: "planning_pr", label: "広報" },
      { value: "planning_planning", label: "企画" },
      { value: "planning_management", label: "経営管理" },
      { value: "planning_other", label: "その他管理" },
    ],
  },
  {
    label: "IT エンジニア",
    options: [
      { value: "it_dev", label: "開発エンジニア" },
      { value: "it_infra", label: "インフラエンジニア" },
      { value: "it_internal", label: "社内SE" },
    ],
  },
  {
    label: "サービス業",
    options: [
      { value: "service_sales", label: "販売・接客" },
      { value: "service_cs", label: "カスタマーサポート" },
      { value: "service_ground_staff", label: "空港グランドスタッフ" },
    ],
  },
  {
    label: "保育・福祉・医療",
    options: [
      { value: "care_childcare", label: "保育士" },
      { value: "care_welfare", label: "介護福祉士・ケアマネジャー" },
      { value: "care_nurse", label: "看護師" },
      { value: "care_other", label: "その他医療福祉" },
    ],
  },
  {
    label: "その他",
    options: [{ value: "other", label: "その他（自由記述）" }],
  },
];

/**
 * value から label を取得するヘルパー
 */
export function getGoogleFormCategoryLabel(value: string): string | undefined {
  for (const group of GOOGLE_FORM_CATEGORY_GROUPS) {
    const option = group.options.find((o) => o.value === value);
    if (option) return option.label;
  }
  return undefined;
}
