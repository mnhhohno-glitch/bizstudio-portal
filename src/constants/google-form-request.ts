/**
 * T-171 / T-172: タスクカテゴリ「Googleフォーム作成依頼」関連の共通定数・型。
 *
 * - タスク作成ウィザード（/tasks/new）のカスタムUIが「フォーム作成指定データ」
 *   フィールドへ機械用 JSON（GoogleFormRequestData）を格納する。
 * - Google フォーム作成モーダルは GET /api/candidates/[id]/google-form/request で
 *   未完了依頼の JSON を受け取り、カテゴリの初期選択・依頼メモの表示に使う。
 * - カテゴリ・フィールドの実体は scripts/seed-google-form-request-category.ts で登録。
 *
 * T-172（2026-08-20）: 依頼を手軽に出せるよう「メイン経験職種カテゴリ」＋「その他メモ」の
 * 2項目だけに簡素化した。依頼時の履歴書AI読み取り・会社別の職種指定は廃止し、
 * 履歴書の解析は受け取った担当者がフォーム作成モーダルで1回だけ行う。
 * 依頼JSON は v2。既に本番へ作成済みの v1 依頼があるため読み取り互換のみ残す。
 */

export const GOOGLE_FORM_REQUEST_CATEGORY = "Googleフォーム作成依頼";

/** 機械用 JSON を格納する TaskTemplateField.label。UI では常に非表示にする。 */
export const GOOGLE_FORM_REQUEST_DATA_LABEL = "フォーム作成指定データ";

/**
 * ウィザード（/tasks/new）の generic 描画から隠すラベル。
 * - 「メイン経験職種カテゴリ」「その他メモ」: カスタムUIで代替
 * - 「フォーム作成指定データ」: 機械用 JSON
 * - 「会社別職種分類」: T-172 で廃止。TaskTemplateField は既存タスクの
 *   TaskFieldValue 保全のため物理削除せず、この非表示リストで新規作成時に出さない。
 */
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

/** T-172 以降の依頼JSON。依頼内容はカテゴリ選択とメモの2項目だけ。 */
export type GoogleFormRequestDataV2 = {
  v: 2;
  /** 大項目ラベル（GOOGLE_FORM_CATEGORY_GROUPS.label） */
  groupKey: string;
  /** サブカテゴリ値（candidate-intake に渡すコード） */
  categoryValue: string;
  /** categoryValue === "other" のときの自由記述ラベル */
  otherLabel: string;
  /** 会社ごとの職種の補足・申し送り事項（自由記述） */
  memo: string;
};

/**
 * T-171 時代の依頼JSON（v1）。T-172 で書き込みは廃止したが、
 * 本番に作成済みの依頼タスクが残っているため読み取り互換のためだけに残す。
 * 会社情報（companies）・履歴書解析結果（resumeData）・ファイル指定は無視する。
 */
export type GoogleFormRequestDataV1 = {
  v: 1;
  inputMode?: "extract" | "manual";
  pdfFileId?: string | null;
  txtFileId?: string | null;
  resumeData?: unknown;
  companies?: unknown;
  groupKey?: string;
  categoryValue?: string;
  otherLabel?: string;
  memo?: string;
};

/** 現行の依頼JSON型（= v2）。 */
export type GoogleFormRequestData = GoogleFormRequestDataV2;

/**
 * 依頼JSON（v1 / v2 のどちらか）を v2 形へ正規化する。
 * v1 が来た場合は groupKey / categoryValue / otherLabel / memo だけを拾い、
 * companies・resumeData・pdfFileId・txtFileId は捨てる。
 * オブジェクトでない・カテゴリが空の場合は null（依頼なし扱い）。
 */
export function normalizeGoogleFormRequestData(raw: unknown): GoogleFormRequestDataV2 | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const categoryValue = str(d.categoryValue);
  if (!categoryValue) return null;
  return {
    v: 2,
    groupKey: str(d.groupKey),
    categoryValue,
    otherLabel: str(d.otherLabel),
    memo: str(d.memo),
  };
}
