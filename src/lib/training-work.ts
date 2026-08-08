// 記述式ワークの設問ラベル（TrainingWorkSet.fieldLabels）の型と正規化。
// key は TrainingWorkAnswer の既存カラム名を流用するため、この4つ以外は受け付けない。
export const ANSWER_KEYS = [
  "answerCompany",
  "answerHelp",
  "answerDay",
  "answerUnknown",
] as const;

export type AnswerKey = (typeof ANSWER_KEYS)[number];

export type FieldLabel = {
  key: AnswerKey;
  label: string;
  placeholder: string;
  rows: number;
};

function isAnswerKey(v: unknown): v is AnswerKey {
  return typeof v === "string" && (ANSWER_KEYS as readonly string[]).includes(v);
}

/**
 * DB の Json をそのまま UI に流すと壊れたデータで画面が落ちるため、
 * 既知の key のみ・最大4件に正規化してから使う。
 */
export function normalizeFieldLabels(value: unknown): FieldLabel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<AnswerKey>();
  const out: FieldLabel[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (!isAnswerKey(r.key) || seen.has(r.key)) continue;
    seen.add(r.key);
    out.push({
      key: r.key,
      label: typeof r.label === "string" ? r.label : r.key,
      placeholder: typeof r.placeholder === "string" ? r.placeholder : "",
      rows: typeof r.rows === "number" && r.rows > 0 ? Math.min(Math.round(r.rows), 12) : 2,
    });
    if (out.length >= ANSWER_KEYS.length) break;
  }
  return out;
}

/**
 * 「分からなかった言葉」の一覧ビュー（講師が講義の重点を決めるために使う）を出すワークかどうか。
 * ワーク①は同じ answerUnknown 列を「1日の動き」に流用しているため、
 * key の有無ではなく設問文で判定する。
 */
export function hasUnknownWordsField(fields: FieldLabel[]): boolean {
  return fields.some((f) => f.key === "answerUnknown" && f.label.includes("分からなかった言葉"));
}
