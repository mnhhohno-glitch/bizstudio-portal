// T-206: 面接対策ページの定数と「選考終了」判定。
//
// 選考終了の判定は entry-flag-rules.ts / candidate-flags.ts（変更禁止）を読んで独立コピーとして持つ。
// 参考にした既存定義:
//   - src/lib/constants/entry-flag-rules.ts SELECTION_ENDED_DETAILS / INACTIVE_TRIGGERS
//   - src/app/api/entries/route.ts CLOSED_FLAG_DETAILS（書類見送り・面接見送りを含む）
//   - src/components/entries/EntryBoard.tsx END_FLAG_DETAILS（一括終了モーダル）
//   - src/lib/aiRead/caKpi.ts entryStageCaseSql（declined / rejected / closed / joined）
//   - src/lib/entries/selection-status-label.ts NOTIFIED_REJECTION_PERSON_FLAGS
import { SELECTION_ENDED_DETAILS } from "@/lib/constants/entry-flag-rules";

/** 種別（画面の選択肢・そのまま保存） */
export const MENSETSU_STAGES = [
  "一次面接",
  "二次面接",
  "三次面接",
  "最終面接",
  "模擬面接まとめ",
  "その他",
] as const;
export type MensetsuStage = (typeof MENSETSU_STAGES)[number];
export function isMensetsuStage(v: unknown): v is MensetsuStage {
  return typeof v === "string" && (MENSETSU_STAGES as readonly string[]).includes(v);
}

/** 保存する status（期限切れ・選考終了は保存せず計算する） */
export const PAGE_STATUS = { draft: "draft", published: "published", stopped: "stopped" } as const;
export type PageStatus = (typeof PAGE_STATUS)[keyof typeof PAGE_STATUS];

/** 公開期限の既定日数（公開日を 1 日目として 30 日目の 23:59 JST まで） */
export const DEFAULT_PUBLIC_DAYS = 30;

/** HTML アップロードの上限（公開サイト Vercel が一度に返せる大きさに収める） */
export const MAX_HTML_BYTES = 4 * 1024 * 1024;

/** 本人確認トークンの有効期間（秒）＝ 90 日 */
export const VIEWER_TOKEN_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

/** 生年月日の入力ミスの回数制限 */
export const VERIFY_LOCK = {
  shortFailCount: 5, // 連続 5 回不一致で
  shortLockMs: 15 * 60 * 1000, // 15 分ロック
  longFailCount: 20, // 24 時間以内に 20 回不一致で
  longLockMs: 24 * 60 * 60 * 1000, // 24 時間ロック
  windowMs: 24 * 60 * 60 * 1000, // 失敗回数を数える窓
} as const;

// ---------------------------------------------------------------------------
// 選考終了の判定（この状態のエントリーにひもづいたページは自動で公開終了＝410 closed）
// ---------------------------------------------------------------------------

/** entryFlagDetail で終了扱いにする値（見送り・辞退・クローズ・内定承諾） */
export const CLOSED_ENTRY_FLAG_DETAILS: readonly string[] = [
  ...SELECTION_ENDED_DETAILS, // 選考落ち / 本人辞退 / 本人辞退_他社決 / 本人辞退_自社他 / クローズ / 求人クローズ
  "書類見送り",
  "面接見送り",
  "承諾", // 内定承諾（entryFlag=内定）
];

/** personFlag（本人対応）で終了扱いにする値。「見送り通知未送信」は本人へ未通知なので含めない */
export const CLOSED_PERSON_FLAGS: readonly string[] = [
  "見送り通知送信済",
  "見送り通知済み",
  "辞退受付済",
  "入社済",
];

/** companyFlag（企業対応）で終了扱いにする値 */
export const CLOSED_COMPANY_FLAGS: readonly string[] = ["辞退報告済", "入社報告済"];

/** entryFlag（大分類）で終了扱いにする値 */
export const CLOSED_ENTRY_FLAGS: readonly string[] = ["入社済"];

export type ClosableEntry = {
  entryFlag: string | null;
  entryFlagDetail: string | null;
  personFlag: string | null;
  companyFlag: string | null;
  acceptanceDate?: Date | string | null;
  archivedAt?: Date | string | null;
};

/**
 * エントリーの選考が終わっているか。
 *   - entryFlag が 入社済
 *   - entryFlagDetail が 見送り・辞退・クローズ・承諾
 *   - personFlag が 見送り通知済み系・辞退受付済・入社済
 *   - companyFlag が 辞退報告済・入社報告済
 *   - entryFlag=内定 かつ 承諾日（acceptanceDate）あり
 *   - アーカイブ済み（archivedAt あり）
 * null（ひもづけ無し）は「終了していない」。
 */
export function isEntryClosed(entry: ClosableEntry | null | undefined): boolean {
  if (!entry) return false;
  if (entry.archivedAt) return true;
  if (entry.entryFlag && CLOSED_ENTRY_FLAGS.includes(entry.entryFlag)) return true;
  if (entry.entryFlagDetail && CLOSED_ENTRY_FLAG_DETAILS.includes(entry.entryFlagDetail)) return true;
  if (entry.personFlag && CLOSED_PERSON_FLAGS.includes(entry.personFlag)) return true;
  if (entry.companyFlag && CLOSED_COMPANY_FLAGS.includes(entry.companyFlag)) return true;
  if (entry.entryFlag === "内定" && entry.acceptanceDate) return true;
  return false;
}

/** 選考終了判定に必要なエントリーの select（Prisma） */
export const CLOSABLE_ENTRY_SELECT = {
  id: true,
  companyName: true,
  entryFlag: true,
  entryFlagDetail: true,
  personFlag: true,
  companyFlag: true,
  acceptanceDate: true,
  archivedAt: true,
} as const;
