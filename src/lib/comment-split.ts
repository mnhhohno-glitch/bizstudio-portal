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

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/^###?\s+/gm, "")
    .replace(/^-{3,}\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * マイページに送信する本人向けコメントを抽出する。
 *
 * - 新フォーマット（2セクション）: ヘッダー（企業名+タイトル）+「おすすめポイント（本人向け）」本文を返す
 *   （評価行・CA向けセクション・Markdown装飾は除去）
 * - 旧フォーマット: 従来通り「懸念」「確認事項」セクションを除去した内容を返す
 */
export function extractCandidateFacingComment(
  comment: string | null | undefined
): string {
  if (!comment) return "";

  const text = comment;
  const cmCandidate = text.match(CANDIDATE_HEADER_RE);

  if (cmCandidate && cmCandidate.index !== undefined) {
    const header = text.substring(0, cmCandidate.index)
      .replace(RATING_LINE_RE, "")
      .trim();
    const start = cmCandidate.index + cmCandidate[0].length;
    const rest = text.substring(start);
    const cmCa = rest.match(CA_HEADER_RE);
    const end = cmCa && cmCa.index !== undefined ? cmCa.index : rest.length;
    const body = rest.substring(0, end).trim();
    const parts = [header, body].filter(Boolean).join("\n\n");
    return stripMarkdown(parts);
  }

  // 旧フォーマットのフォールバック
  return stripMarkdown(
    text
      .replace(RATING_LINE_RE, "")
      .replace(/◆\s*懸念[^◆]*/g, "")
      .replace(/◆\s*確認事項[^◆]*/g, "")
  );
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

/**
 * マイページ求人詳細に表示する「本人向けおすすめポイント」本文を切り出す（フェイルクローズ）。
 *
 * extractCandidateFacingComment と同一の見出し正規表現（CANDIDATE_HEADER_RE / CA_HEADER_RE）と
 * stripMarkdown、および同一の本文抽出（CF見出し直後〜CA見出し直前の substring）を用いる。
 * 新しい切り出しロジックは持ち込まない。異なるのは表示要件に沿った次の2点のみ:
 *
 *   1. フェイルクローズ: 「◆ おすすめポイント（本人向け）」と「◆ 選考分析（CA向け）」の
 *      両見出しが正順（CF→CA）で揃う場合のみ本文を返す。CA見出しが CF より後ろに存在しない場合
 *      （片方欠落・逆順・旧フォーマット・見出しなし・空）は一律 null。
 *      → CA向け情報（通過率・懸念点等）がマイページに漏れることを構造的に防ぐ。境界が確定できない
 *        分析文は「部分的に返す」のではなく一切返さない。
 *      （extractCandidateFacingComment は CA見出しが無い場合に CF見出し以降の全文を返すため、
 *        本番調査で CA向け内容の漏洩が確認された。本関数はその挙動を採らない。）
 *   2. 企業名タイトルの見出し（【会社名】…）を含めない（表示側が独自にセクション見出しを付けるため
 *      本文のみを返す）。
 *
 * sync-ca-comments 等が使う extractCandidateFacingComment の挙動には一切影響しない（独立した別関数）。
 * trailing `**` 等の Markdown 装飾は stripMarkdown が除去する。
 *
 * @returns 本人向け本文（string）。切り出せない場合は null。
 */
export function extractRecommendationForDisplay(
  comment: string | null | undefined
): string | null {
  if (!comment) return null;

  const cmCandidate = comment.match(CANDIDATE_HEADER_RE);
  if (!cmCandidate || cmCandidate.index === undefined) return null;

  // CF見出し直後以降だけを対象に CA見出しを探す。ここで見つかる＝CA が CF より後ろにある（正順）。
  const start = cmCandidate.index + cmCandidate[0].length;
  const rest = comment.substring(start);

  const cmCa = rest.match(CA_HEADER_RE);
  // フェイルクローズ: CA見出しが CF見出しより後ろに存在しなければ返さない。
  if (!cmCa || cmCa.index === undefined) return null;

  // 本文 = CF見出し直後 〜 CA見出し直前（extractCandidateFacingComment の body と同一抽出）。
  const body = rest.substring(0, cmCa.index).trim();
  if (!body) return null;

  const cleaned = stripMarkdown(body);
  return cleaned.length ? cleaned : null;
}
