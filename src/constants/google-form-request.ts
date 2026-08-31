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
 * 2項目に簡素化し、会社別の職種指定を廃止した（依頼JSON v2）。
 *
 * T-172 追補（2026-08-20）: メインカテゴリだけでは会社単位の指定ができず不十分だったため、
 * **会社別の職種指定を復活**させた（依頼JSON v3）。ただし依頼時の履歴書AI読み取り
 * （30〜75秒待ち）は復活させない。会社名・在籍期間は面談ログ解析で既にDBへ入っている
 * WorkHistory（GET /api/candidates/[id]/work-histories）から**同期・AI呼び出し無し**で取る。
 * 既に本番へ作成済みの v1 / v2 依頼があるため、読み取り互換を normalize で維持する。
 */

export const GOOGLE_FORM_REQUEST_CATEGORY = "Googleフォーム作成依頼";

/** 機械用 JSON を格納する TaskTemplateField.label。UI では常に非表示にする。 */
export const GOOGLE_FORM_REQUEST_DATA_LABEL = "フォーム作成指定データ";

/**
 * ウィザード（/tasks/new）の generic 描画から隠すラベル。
 * すべてカスタムUI（またはJSON）で代替しているため、素の入力欄を二重に出さないためのリスト。
 * タスク詳細ページ（/tasks/[taskId]）はこのリストを使わず「フォーム作成指定データ」だけを隠すので、
 * 「会社別職種分類」はここに入れたままでもタスク詳細では表示される。
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

/** 依頼JSON v3 の会社1社分。会社名でフォーム作成モーダルの会社カードに対応付ける。 */
export type GoogleFormRequestCompany = {
  /** 会社名（WorkHistory.companyName 由来 or 手入力） */
  name: string;
  /** 在籍期間の表示文字列（「2016-04〜2017-11」「1年7ヶ月」など。任意） */
  period: string;
  /** 大項目ラベル（GOOGLE_FORM_CATEGORY_GROUPS.label） */
  groupKey: string;
  /** サブカテゴリ値（candidate-intake に渡すコード） */
  categoryValue: string;
  /** この会社での職種の補足（任意・モーダルにヒント表示） */
  detail: string;
};

/** T-172 追補 以降の依頼JSON。会社別指定（companies）を持つが、履歴書解析結果は持たない。 */
export type GoogleFormRequestDataV3 = {
  v: 3;
  /** 大項目ラベル（GOOGLE_FORM_CATEGORY_GROUPS.label） */
  groupKey: string;
  /** サブカテゴリ値（candidate-intake に渡すコード） */
  categoryValue: string;
  /** categoryValue === "other" のときの自由記述ラベル */
  otherLabel: string;
  /** 全体への申し送り事項（自由記述） */
  memo: string;
  /** 会社別の職種指定（任意。0件でも依頼は成立する） */
  companies: GoogleFormRequestCompany[];
};

/** T-172 の依頼JSON（v2）。会社別指定を持たない。読み取り互換のためだけに残す。 */
export type GoogleFormRequestDataV2 = {
  v: 2;
  groupKey: string;
  categoryValue: string;
  otherLabel: string;
  memo: string;
};

/**
 * T-171 時代の依頼JSON（v1）。読み取り互換のためだけに残す。
 * companies は拾う（v3 と同じ意味）。履歴書解析結果（resumeData）・ファイル指定は無視する。
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

/** 現行の依頼JSON型（= v3）。 */
export type GoogleFormRequestData = GoogleFormRequestDataV3;

/**
 * 依頼JSON（v1 / v2 / v3 のいずれか）を v3 形へ正規化する。
 * - v1: companies を拾い、resumeData / pdfFileId / txtFileId / index は捨てる
 * - v2: companies が無いので空配列
 * - v3: そのまま（欠けたキーは空文字・空配列で補完）
 * オブジェクトでない・カテゴリが空の場合は null（依頼なし扱い）。
 */
export function normalizeGoogleFormRequestData(raw: unknown): GoogleFormRequestDataV3 | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const categoryValue = str(d.categoryValue);
  if (!categoryValue) return null;
  return {
    v: 3,
    groupKey: str(d.groupKey),
    categoryValue,
    otherLabel: str(d.otherLabel),
    memo: str(d.memo),
    companies: normalizeCompanies(d.companies),
  };
}

function normalizeCompanies(raw: unknown): GoogleFormRequestCompany[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({
      name: str(c.name).trim(),
      period: str(c.period).trim(),
      groupKey: str(c.groupKey),
      categoryValue: str(c.categoryValue),
      detail: str(c.detail).trim(),
    }))
    // 会社名が無い行はモーダル側で対応付けようがないので落とす
    .filter((c) => c.name.length > 0);
}

/**
 * 会社名の突き合わせ用の正規化。
 * 全角/半角のゆれ（NFKC）を吸収し、空白をすべて除去して比較する。
 */
export function normalizeCompanyNameForMatch(name: string | undefined | null): string {
  return (name ?? "").normalize("NFKC").replace(/\s+/g, "");
}
