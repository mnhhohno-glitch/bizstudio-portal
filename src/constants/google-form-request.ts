/**
 * T-171: タスクカテゴリ「Googleフォーム作成依頼」関連の共通定数・型。
 *
 * - タスク作成ウィザード（/tasks/new）のカスタムUIが「フォーム作成指定データ」
 *   フィールドへ機械用 JSON（GoogleFormRequestData）を格納する。
 * - Google フォーム作成モーダルは GET /api/candidates/[id]/google-form/request で
 *   未完了依頼の JSON を受け取り、初期選択・extract 省略に使う。
 * - カテゴリ・フィールドの実体は scripts/seed-google-form-request-category.ts で登録。
 */

export const GOOGLE_FORM_REQUEST_CATEGORY = "Googleフォーム作成依頼";

/** 機械用 JSON を格納する TaskTemplateField.label。UI では常に非表示にする。 */
export const GOOGLE_FORM_REQUEST_DATA_LABEL = "フォーム作成指定データ";

/** ウィザード・タスク詳細の generic 描画から隠すラベル（カスタムUI/機械用）。 */
export const GOOGLE_FORM_REQUEST_HIDDEN_LABELS = [
  "メイン経験職種カテゴリ",
  "会社別職種分類",
  "その他メモ",
  GOOGLE_FORM_REQUEST_DATA_LABEL,
];

/**
 * カテゴリ名 → 既定担当者（社員番号）のマップ。
 * エントリー対応（EntryBoard の ENTRY_TASK_DEFAULT_ASSIGNEES）と同じ考え方。
 * 佐藤 葵(1000025)・見ル野 未来(1000027)・道西 未来(1000029)。
 */
export const CATEGORY_DEFAULT_ASSIGNEE_NUMBERS: Record<string, string[]> = {
  [GOOGLE_FORM_REQUEST_CATEGORY]: ["1000025", "1000027", "1000029"],
};

export type GoogleFormRequestCompany = {
  /** extract 時は work_history 配列のインデックス。手入力時は行番号。 */
  index: number;
  name: string;
  period: string;
  /** 大項目ラベル（GOOGLE_FORM_CATEGORY_GROUPS.label） */
  groupKey: string;
  /** サブカテゴリ値（candidate-intake に渡すコード） */
  categoryValue: string;
  /** 会社ごとの職種詳細（自由記述・任意）。モーダルではヒント表示のみ。 */
  detail: string;
};

export type GoogleFormRequestData = {
  v: 1;
  /** 会社リストの入力方式: extract=履歴書読み取り / manual=手入力 */
  inputMode: "extract" | "manual";
  /** extract 時に使った面談PDF の CandidateFile.id（手入力時は null） */
  pdfFileId: string | null;
  /** extract 時に使った面談ログ(.txt)の CandidateFile.id（手入力時は null） */
  txtFileId: string | null;
  /** extract-resume API の resumeData そのまま（手入力時は null） */
  resumeData: unknown | null;
  groupKey: string;
  categoryValue: string;
  otherLabel: string;
  companies: GoogleFormRequestCompany[];
  memo: string;
};
