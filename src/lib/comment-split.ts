/**
 * AI分析コメントの本人向け/CA向けセクション分離ユーティリティ
 *
 * 新フォーマット:
 *   ◆ おすすめポイント（本人向け）
 *   （本人向けの推薦内容）
 *   ◆ 選考分析（CA向け）
 *   （CA向けの現実的評価）
 *
 * 旧フォーマット:
 *   ◆ 推薦コメント
 *   （1セクションで全部記載）
 */

const CANDIDATE_HEADER_RE = /◆\s*おすすめポイント（本人向け）\s*/;
const CA_HEADER_RE = /◆\s*選考分析（CA向け）\s*/;
const RATING_LINE_RE = /■\s*(本人希望|通過率|総合)[：:]\s*[ABCD]\s*/g;

/**
 * マイページに送信する本人向けコメントを抽出する。
 *
 * - 新フォーマット（2セクション）: 「おすすめポイント（本人向け）」セクションの本文のみ返す
 *   （ヘッダー行自体は含めない）
 * - 旧フォーマット: 従来通り「懸念」「確認事項」セクションを除去した内容を返す
 * - 評価行（■ 本人希望 等）は常に除去
 */
export function extractCandidateFacingComment(
  comment: string | null | undefined
): string {
  if (!comment) return "";

  const text = comment;
  const cmCandidate = text.match(CANDIDATE_HEADER_RE);

  if (cmCandidate && cmCandidate.index !== undefined) {
    // 新フォーマット
    const start = cmCandidate.index + cmCandidate[0].length;
    const rest = text.substring(start);
    const cmCa = rest.match(CA_HEADER_RE);
    const end = cmCa && cmCa.index !== undefined ? cmCa.index : rest.length;
    return rest
      .substring(0, end)
      .replace(RATING_LINE_RE, "")
      .trim();
  }

  // 旧フォーマットのフォールバック
  return text
    .replace(RATING_LINE_RE, "")
    .replace(/◆\s*懸念[^◆]*/g, "")
    .replace(/◆\s*確認事項[^◆]*/g, "")
    .trim();
}

/**
 * ポータル表示用に、コメントを本人向け/CA向けの2セクションに分離する。
 *
 * 新フォーマットでない場合は hasSections=false を返し、呼び出し側で
 * 従来通りのまとめ表示をフォールバックとして使う。
 */
export function splitAnalysisComment(
  comment: string | null | undefined
): {
  header: string;
  candidateFacing: string | null;
  caFacing: string | null;
  hasSections: boolean;
} {
  if (!comment) {
    return { header: "", candidateFacing: null, caFacing: null, hasSections: false };
  }

  const text = comment;
  const cmCandidate = text.match(CANDIDATE_HEADER_RE);

  if (!cmCandidate || cmCandidate.index === undefined) {
    return { header: text, candidateFacing: null, caFacing: null, hasSections: false };
  }

  const header = text.substring(0, cmCandidate.index).trim();
  const afterCandidate = cmCandidate.index + cmCandidate[0].length;

  const cmCa = text.substring(afterCandidate).match(CA_HEADER_RE);
  if (cmCa && cmCa.index !== undefined) {
    const caStartRel = cmCa.index;
    const candidateFacing = text
      .substring(afterCandidate, afterCandidate + caStartRel)
      .trim();
    const caFacing = text
      .substring(afterCandidate + caStartRel + cmCa[0].length)
      .trim();
    return { header, candidateFacing, caFacing, hasSections: true };
  }

  return {
    header,
    candidateFacing: text.substring(afterCandidate).trim(),
    caFacing: null,
    hasSections: true,
  };
}
