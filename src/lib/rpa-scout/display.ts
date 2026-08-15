// 一覧の「未選択・未設定」表示の統一。
// 同じ条件でも、移行データ（rawConditions の原文）と新規作成データ（構造化カラム）とで
// 空の表し方が違う（null / undefined / "" / [] / {} / "-" / "指定なし"）。
// 判定をこの1箇所に集約し、どの列・どの由来でも同じ表記になるようにする。

export const UNSET_LABEL = "指定なし";

// 移行データの原文で「未設定」を意味する文字列（Excel 上の表記ゆれ）
const UNSET_TEXTS = new Set(["-", "‐", "ー", "―", "−", "なし", UNSET_LABEL]);

export function isUnset(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") {
    const s = value.trim();
    return s === "" || UNSET_TEXTS.has(s);
  }
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

// 候補を先頭から順に見て、最初の「未設定でない」値を表示文字列として返す。
// すべて未設定なら UNSET_LABEL。構造化カラム優先・移行原文フォールバックの並びで渡す。
export function firstSetOr(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (!isUnset(c)) return String(c);
  }
  return UNSET_LABEL;
}
