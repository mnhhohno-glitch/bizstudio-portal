// T-208 step2: 台本の答えを入力画面の欄に入れるときの決まり（付録F）。純粋関数。
//
// - 欄が空のときだけ入れる。すでに値があれば勝手に変えず「台本の答え（〇〇）に替えますか？」（propose）。
// - メモ欄は、空なら入れ、入っていれば末尾に「【台本】」を付けて書き足す（同じ文がすでにあれば足さない）。
// - ボタンを押し直したとき、欄が前に台本が入れた値のままなら差し替え、CA が手で直していたら触らない（applied で判断）。
// - 働き方のチェックは、無ければ付ける（外さない）。
//
// 欄のパス: "d.<列>"（interview_details）/ "wh.<会社番号>.<列>"（work_histories）/ "ws.<項目>"（働き方）

import type { AppliedMap, FieldTarget } from "./types";

export const SCRIPT_MEMO_PREFIX = "【台本】";

export type ApplyAction = "set" | "append" | "replace" | "skip" | "propose";

export type ApplyDecision = {
  path: string;
  target: FieldTarget;
  action: ApplyAction;
  /** 欄に入れる新しい値（set / append / replace のとき）。propose のときは提案する値 */
  nextValue: string;
  /** applied に記録する値（skip のときは変えない） */
  appliedValue: string;
};

export function fieldPath(target: FieldTarget, companyIndex?: number): string {
  if (target.kind === "detail") return `d.${target.field}`;
  if (target.kind === "wh") return `wh.${companyIndex ?? 0}.${target.field}`;
  return `ws.${target.item}`;
}

export function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

/** 日付欄は ISO で持っていることがあるので、先頭の年月日（または年月）で比べる */
function sameValue(current: unknown, applied: string, isDate: boolean): boolean {
  const c = asText(current);
  if (!isDate) return c === applied;
  return c.slice(0, applied.length) === applied || applied.slice(0, c.length) === c;
}

const DATE_FIELDS = new Set(["resignationDate", "nextInterviewDate"]);

/**
 * 1つの欄に対する入れ方を決める。
 * @param current  いまの欄の値
 * @param prevApplied 前に台本がこの欄に入れた値（無ければ undefined）
 * @param value    今回入れたい値（空文字なら「台本が入れた分を消す」）
 */
export function decideApply(
  target: FieldTarget,
  companyIndex: number | undefined,
  current: unknown,
  prevApplied: string | undefined,
  value: string,
): ApplyDecision {
  const path = fieldPath(target, companyIndex);
  const base = { path, target };

  if (target.kind === "workStyle") {
    const list = Array.isArray(current) ? (current as string[]) : [];
    const has = list.includes(target.item);
    if (!value) {
      // 押し直しで外れた: 台本が付けたチェックのままなら外す。CA が付けたものは触らない
      if (has && prevApplied === "1") return { ...base, action: "set", nextValue: "", appliedValue: "" };
      return { ...base, action: "skip", nextValue: has ? "1" : "", appliedValue: prevApplied ?? "" };
    }
    if (has) return { ...base, action: "skip", nextValue: "1", appliedValue: "1" };
    return { ...base, action: "set", nextValue: "1", appliedValue: "1" };
  }

  const memo = !!target.memo;
  const cur = asText(current);

  if (memo) {
    const v = value.trim();
    if (cur.trim() === "") {
      if (!v) return { ...base, action: "skip", nextValue: cur, appliedValue: "" };
      return { ...base, action: "set", nextValue: v, appliedValue: v };
    }
    // 押し直し: 前に台本が入れた文がそのまま残っていれば差し替える
    if (prevApplied && cur.includes(prevApplied)) {
      const keepPrefix = prevApplied.startsWith(SCRIPT_MEMO_PREFIX);
      const chunk = v ? (keepPrefix ? SCRIPT_MEMO_PREFIX + v : v) : "";
      if (chunk === prevApplied) return { ...base, action: "skip", nextValue: cur, appliedValue: prevApplied };
      let next = cur.replace(prevApplied, chunk);
      if (!chunk) next = next.replace(/\n{2,}/g, "\n").replace(/^\n+|\n+$/g, "");
      return { ...base, action: "replace", nextValue: next, appliedValue: chunk };
    }
    if (!v) return { ...base, action: "skip", nextValue: cur, appliedValue: prevApplied ?? "" };
    if (cur.includes(v)) return { ...base, action: "skip", nextValue: cur, appliedValue: v };
    const chunk = SCRIPT_MEMO_PREFIX + v;
    return { ...base, action: "append", nextValue: `${cur.replace(/\s+$/, "")}\n${chunk}`, appliedValue: chunk };
  }

  // 選択・数値・文字の欄
  const isDate = target.kind === "detail" && DATE_FIELDS.has(target.field);
  if (isEmptyValue(current)) {
    if (!value) return { ...base, action: "skip", nextValue: "", appliedValue: "" };
    return { ...base, action: "set", nextValue: value, appliedValue: value };
  }
  if (prevApplied !== undefined && sameValue(current, prevApplied, isDate)) {
    if (sameValue(current, value, isDate)) return { ...base, action: "skip", nextValue: cur, appliedValue: value };
    return { ...base, action: "set", nextValue: value, appliedValue: value };
  }
  if (sameValue(current, value, isDate)) return { ...base, action: "skip", nextValue: cur, appliedValue: value };
  if (!value) return { ...base, action: "skip", nextValue: cur, appliedValue: prevApplied ?? "" };
  return { ...base, action: "propose", nextValue: value, appliedValue: prevApplied ?? "" };
}

/** applied を更新した新しい表を返す（skip のときは変えない） */
export function nextApplied(applied: AppliedMap, decision: ApplyDecision): AppliedMap {
  if (decision.action === "skip" || decision.action === "propose") return applied;
  const next = { ...applied };
  if (decision.appliedValue === "") delete next[decision.path];
  else next[decision.path] = decision.appliedValue;
  return next;
}

/** CA が「替える」を押したとき（提案を受け入れる）。欄の値は提案値になり、applied にも記録する */
export function acceptProposal(applied: AppliedMap, path: string, value: string): AppliedMap {
  return { ...applied, [path]: value };
}
