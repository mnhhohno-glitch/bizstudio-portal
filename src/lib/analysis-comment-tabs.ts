// 求人評価モーダルのタブ表示用に、AI分析コメント本文を「タイトル行」と「評価本文」に切り出す。
//
// ⚠️ 表示専用。aiAnalysisComment の保存内容は一切加工しない（描画時に切り出すだけ）。
//    評価マーカー行（■ 本人希望 / ■ 通過率 / ■ 総合）はここでは触らない。従来どおり
//    3軸セレクトが parse3AxisRatings で読み、updateRatingMarker が本文を書き換える。
//    本文表示側の除去は cleanAnalysisComment が担当する（役割を重複させない）。
//
// タブ構成:
//   評価     … 「◆ おすすめポイント（本人向け）」＋「◆ 選考分析（CA向け）」＝ ここが返す evaluationBody
//   仕事内容 / 会社概要 … aiAnalysisComment とは別データ（/job-info の BookmarkJobInfo・T-184）

export type AnalysisTabSplit = {
  /** 本文先頭の「【会社名】求人タイトル」行（装飾を除いた表示用文字列）。無ければ null。 */
  titleLine: string | null;
  /**
   * 「◆ 」始まりの見出しを持つ新フォーマットか。
   * false（旧形式・手編集済み）の場合、呼び出し側はタブを出さず従来どおり全文表示にフォールバックする。
   */
  hasSections: boolean;
  /** 評価タブに出す本文（タイトル行だけを除いた本文全体。見出し「◆ …」は残す）。 */
  evaluationBody: string;
};

/** 「◆ …」の見出し行か。 */
function isSectionHeading(line: string): boolean {
  return /^\s*(?:\*\*)?◆/.test(line);
}

/** 「【会社名】求人タイトル」行か（## / ** の装飾付きも許容）。 */
function isTitleLine(line: string): boolean {
  return /^\s*(?:#{1,3}\s*)?(?:\*\*)?\s*【[^】]+】/.test(line);
}

/** 表示用にタイトル行の Markdown 装飾を落とす。 */
function cleanTitle(line: string): string {
  return line.replace(/\*\*/g, "").replace(/^\s*#{1,3}\s*/, "").trim();
}

/**
 * 本文をタブ表示用に切り出す（純関数・副作用なし）。
 *
 * タイトル行の探索は「最初の ◆ 見出しより前」に限定する。選考分析の項目見出し
 * （【必須要件充足】〇 等・T-180）を会社名タイトルと誤認しないため。
 */
export function splitAnalysisForTabs(comment: string | null | undefined): AnalysisTabSplit {
  if (!comment) {
    return { titleLine: null, hasSections: false, evaluationBody: "" };
  }

  const lines = comment.split("\n");
  const firstHeadingIdx = lines.findIndex(isSectionHeading);
  const hasSections = firstHeadingIdx >= 0;

  if (!hasSections) {
    // 旧形式・手編集済み: 切り出さずそのまま返す（呼び出し側は従来どおり全文表示）。
    return { titleLine: null, hasSections: false, evaluationBody: comment };
  }

  const searchEnd = firstHeadingIdx;
  const titleIdx = lines.findIndex((line, i) => i < searchEnd && isTitleLine(line));
  if (titleIdx < 0) {
    return { titleLine: null, hasSections: true, evaluationBody: comment };
  }

  const evaluationBody = lines.filter((_, i) => i !== titleIdx).join("\n");
  return { titleLine: cleanTitle(lines[titleIdx]), hasSections: true, evaluationBody };
}
