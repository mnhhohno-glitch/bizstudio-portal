/**
 * T-029 Phase D-2 / T-170: Google Form 自動生成で使用する 36 サブカテゴリ
 * （`other`（その他・自由記述）を含めた選択肢は 37、大項目は 10）
 *
 * このファイルは candidate-intake 側の specs/generate_form_prompt.yaml の
 * target_subcategories 定義と内容を同期する必要がある。
 * candidate-intake 側を更新したら portal 側も同期更新すること（逆も同じ）。
 * candidate-intake は未知コードを黙って default にフォールバックするため、
 * コードのタイポは画面上では気づけない（ログの `Unknown subcategory` 警告のみ）。
 * 追加・変更時は両リポジトリ同時更新＋コード文字列の突合を必須とする。
 *
 * 大項目（グループ）の定義は candidate-intake 側には存在せず、このファイルにのみ存在する。
 * グループのキーは label（日本語文字列）そのもの（GoogleFormRequestData.groupKey に保存される）。
 *
 * サブカテゴリのコードは全グループを通して一意（T-170 で `service_cs` の重複を解消）。
 *
 * 関連ファイル:
 * - candidate-intake: specs/generate_form_prompt.yaml
 * - portal: src/components/candidates/GoogleFormCreatorModal.tsx
 * - portal: src/app/(app)/tasks/new/page.tsx（Googleフォーム作成依頼タスク）
 */

export type GoogleFormCategoryOption = {
  value: string; // candidate-intake API に渡す値（例: "sales_corporate"）
  label: string; // UI 表示ラベル（例: "法人営業"）
};

export type GoogleFormCategoryGroup = {
  label: string; // 大項目ラベル（例: "営業職"）。groupKey としても使う
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
      { value: "office_reception", label: "受付" },
      { value: "service_cs", label: "コールセンター（カスタマーサポート）" },
      { value: "service_cs_sv", label: "コールセンター（SV）" },
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
    // T-170: `service_cs`（カスタマーサポート）は事務職側に一本化したためここには置かない
    label: "サービス業",
    options: [
      { value: "service_sales", label: "販売・接客" },
      { value: "service_ground_staff", label: "空港グランドスタッフ" },
      { value: "service_food", label: "飲食（ホール・店長）" },
      { value: "service_cooking", label: "調理・製菓（調理師・パティシエ）" },
      { value: "service_beauty", label: "美容・理容・エステ" },
      { value: "service_hotel", label: "ホテル・旅行・ブライダル" },
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
    // T-170 追加
    label: "製造・技術",
    options: [
      { value: "mfg_production", label: "製造・工場（ライン・品質管理）" },
      { value: "mfg_construction", label: "施工管理・建築・設備" },
      { value: "mfg_design", label: "機械・電気設計" },
    ],
  },
  {
    // T-170 追加
    label: "物流・運輸",
    options: [
      { value: "logi_driver", label: "ドライバー・配送" },
      { value: "logi_warehouse", label: "倉庫・物流管理" },
    ],
  },
  {
    // T-170 追加
    label: "教育・専門",
    options: [
      { value: "pro_instructor", label: "講師・塾・インストラクター" },
      { value: "pro_finance", label: "金融・保険（窓口・事務）" },
      { value: "pro_public", label: "公務員・団体職員" },
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

/**
 * T-170: value からその大項目ラベル（groupKey）を引く。コードは全グループで一意。
 */
export function getGoogleFormCategoryGroupLabel(value: string): string | undefined {
  return GOOGLE_FORM_CATEGORY_GROUPS.find((g) => g.options.some((o) => o.value === value))?.label;
}

/**
 * T-170: 保存済みの groupKey を現在の定義に合わせて解決する。
 * 依頼タスク等に保存された groupKey は、定義変更（サブカテゴリの所属グループ変更・削除）で
 * value と食い違うことがある。value の実所属を優先し、value 側が未知のときのみ保存値を返す。
 */
export function resolveGoogleFormGroupKey(
  savedGroupKey: string | undefined | null,
  value: string | undefined | null,
): string {
  if (!value) return savedGroupKey ?? "";
  return getGoogleFormCategoryGroupLabel(value) ?? savedGroupKey ?? "";
}
