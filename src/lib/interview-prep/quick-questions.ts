// T-208 step3（付録G）: 面談準備チャットの入力欄の上に並べる「よく使う質問」のボタン。
// 画面（InterviewPrepPanel）と確認スクリプトで同じ文を使うため、ここに置く（AI・DB は使わない）。
//
// - kind="fill": 入力欄に文を入れ、〔　〕（QUICK_QUESTION_BLANK）を選んだ状態にする（CA が言葉を打ち替えてから送る）
// - kind="send": 押したらすぐ送る

/** 打ち替えてもらう場所の目印。fill の文にはこれが1つだけ入る */
export const QUICK_QUESTION_BLANK = "〔　〕";

export type QuickQuestion =
  | { key: string; label: string; kind: "fill"; text: string }
  | { key: string; label: string; kind: "send"; text: string };

export const QUICK_QUESTIONS: readonly QuickQuestion[] = [
  { key: "job", label: "職種を説明", kind: "fill", text: `${QUICK_QUESTION_BLANK}という職種を、新人でも分かるように説明して` },
  { key: "industry", label: "業界を説明", kind: "fill", text: `${QUICK_QUESTION_BLANK}という業界を、分かりやすく説明して` },
  { key: "term", label: "言葉の意味", kind: "fill", text: `${QUICK_QUESTION_BLANK}という言葉の意味を、一言で教えて` },
  { key: "alt-jobs", label: "別の職種を提案", kind: "send", text: "この人の経験を生かせる、別の職種・業種を3つ、理由と注意点付きで提案して" },
  { key: "next-ask", label: "次に聞くこと", kind: "send", text: "ここまでの答えを踏まえて、次に深く聞くべき質問を2つ教えて" },
] as const;

/** fill の文の中で〔　〕が始まる位置と終わる位置（選択範囲にする）。無ければ null */
export function blankRangeOf(text: string): { start: number; end: number } | null {
  const start = text.indexOf(QUICK_QUESTION_BLANK);
  if (start < 0) return null;
  return { start, end: start + QUICK_QUESTION_BLANK.length };
}
