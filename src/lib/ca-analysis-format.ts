/**
 * 選考分析（CA向け）の構造化フォーマット（T-180）
 *
 * 新フォーマット（2026-08-25 以降の新規評価）:
 *   【必須要件充足】〇
 *   4大卒〇、ライター職への志望度〇。…
 *
 *   【年収】〇
 *   300万〜400万円。…
 *
 *   【固定残業】▲
 *   45時間が最大の懸念。…
 *
 * 判定記号は 〇（問題なし）/ ▲（懸念あり）/ ×（不適合）の3種。
 * 項目名は固定リストにせず、求人ごとにAIが立てる（従来の柔軟性を維持）。
 *
 * ★新旧の判別方法★
 * 評価は CandidateFile.aiAnalysisComment のプレーンテキスト1カラムにのみ保存され、
 * フォーマット版を持てる構造（JSON カラム等）が無い。そのため
 * 「行全体が `【項目名】記号` である行が1行以上あるか」＝ isStructuredCaAnalysis()
 * をフォーマット判定に使う。過去データ（旧フォーマット）はこの行を持たないため
 * 自動的に false になり、表示は従来どおりのプレーンテキストにフォールバックする。
 * 再評価による移行は行わない（新旧共存）。
 *
 * ★【】の衝突に注意★
 * `【会社名】求人タイトル` は求人セクションの見出しとして分割処理に使われている
 * （analyze-batch の extractRatingsAndComments / compressBatchResultForSummary）。
 * 項目行は「【…】の直後が記号1文字で行末」という点だけが見出し行と異なるので、
 * 分割側は CA_MARK_CLASS を使った否定先読みで項目行を除外すること。
 */

/** 判定記号1文字にマッチする文字クラス（AIの表記ゆれを許容）。キャプチャなし */
export const CA_MARK_CLASS = "[〇○◯▲△×✕✖]";

/** 行全体が「【項目名】記号」である行。$1=項目名 $2=記号 */
const ITEM_LINE_RE = new RegExp(`^\\s*【([^】]+)】\\s*(${CA_MARK_CLASS})\\s*$`);

export type CaMark = "ok" | "warn" | "ng";

/** 記号1文字を意味に正規化する。判定記号でなければ null */
export function normalizeCaMark(symbol: string): CaMark | null {
  if (symbol === "〇" || symbol === "○" || symbol === "◯") return "ok";
  if (symbol === "▲" || symbol === "△") return "warn";
  if (symbol === "×" || symbol === "✕" || symbol === "✖") return "ng";
  return null;
}

export type CaItemHeader = { label: string; mark: CaMark; symbol: string };

/** 1行が項目見出し行なら中身を返す。そうでなければ null */
export function matchCaItemLine(line: string): CaItemHeader | null {
  const m = line.replace(/\*\*/g, "").match(ITEM_LINE_RE);
  if (!m) return null;
  const mark = normalizeCaMark(m[2]);
  if (!mark) return null;
  const label = m[1].trim();
  if (!label) return null;
  return { label, mark, symbol: m[2] };
}

/** 新フォーマット（構造化された選考分析）かどうか */
export function isStructuredCaAnalysis(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.split("\n").some((line) => matchCaItemLine(line) !== null);
}

export type CaAnalysisBlock =
  | ({ kind: "item" } & CaItemHeader)
  | { kind: "text"; text: string };

/**
 * 表示用にテキストを「項目見出し行」と「それ以外のかたまり」に分解する。
 *
 * 項目見出し行以外は連続行をまとめて1つの text ブロックとして返すだけなので、
 * 旧フォーマット（項目行を含まない）では text ブロック1個＝元テキストそのままになり、
 * 従来の表示と完全に一致する。
 */
export function parseCaAnalysisBlocks(text: string): CaAnalysisBlock[] {
  const blocks: CaAnalysisBlock[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const joined = buffer.join("\n").replace(/^\n+|\n+$/g, "");
    if (joined.trim() !== "") blocks.push({ kind: "text", text: joined });
    buffer = [];
  };

  for (const line of text.split("\n")) {
    const item = matchCaItemLine(line);
    if (item) {
      flush();
      blocks.push({ kind: "item", ...item });
    } else {
      buffer.push(line);
    }
  }
  flush();

  return blocks;
}
