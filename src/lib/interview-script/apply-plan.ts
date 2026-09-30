// T-208 step4: 面談スクリプトの答えを面談記録（interview_details / work_histories）に入れる「計画」を作る純粋関数。
//
// step2〜3 では画面（InterviewForm）が state に入れて自動保存に乗せていたが、step4 からはサーバー
// （POST /api/interviews/[id]/script-answers/apply）が DB の今の値に対してここで計画を作り、そのまま書く。
// 1欄ごとの決まり（空欄だけ入れる／違う値があれば提案／押し直しの差し替え／メモの追記と重複防止）は apply.ts の decideApply。
// ここは「複数の書き込みを1つの計画にまとめる」「欄の値の型を合わせる」「提案の表を更新する」だけ。
// 画面（InterviewScriptTab）も同じ関数で「入力内容」タブの表示値（currentValueAt）を作る。確認スクリプトはメモリ上のデータで通す。

import { normalizeDate } from "@/lib/date-utils";
import { acceptProposal, decideApply, nextApplied } from "./apply";
import type { SceneWrite } from "./runtime";
import type { AppliedMap } from "./types";

/** 欄のパス → 提案する値（すでに違う値がある欄に、スクリプトの答えを入れるかを CA に聞く） */
export type ProposalMap = Record<string, { value: string }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DetailLike = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WorkHistoryRowLike = Record<string, any> & { order: number };

/** detail の数値の欄（入れるとき Number にする） */
export const DETAIL_NUMBER_KEYS = new Set(["currentApplicationCount", "currentSalary", "desiredSalaryMin", "desiredSalaryMax"]);
/** detail の日時の欄（入れるとき normalizeDate。月入力 "YYYY-MM" は 1 日に寄せる） */
export const DETAIL_DATETIME_KEYS = ["resignationDate", "nextInterviewDate", "jobSendDeadline"];

/** work_histories の 1社目を interview_details に写す（自動保存 buildAutosaveBody と同じ列） */
export function detailMirrorOfWorkHistories(rows: WorkHistoryRowLike[]): DetailLike {
  if (rows.length === 0) return {};
  const sorted = [...rows].sort((a, b) => a.order - b.order);
  const first = sorted[0];
  const tenure = [
    first.tenureYear != null ? `${first.tenureYear}年` : null,
    first.tenureMonth != null ? `${first.tenureMonth}ヶ月` : null,
  ]
    .filter(Boolean)
    .join("");
  return {
    companyName: first.companyName ?? null,
    businessContent: first.businessContent ?? null,
    tenure: tenure || null,
    jobTypeFlag: first.jobTypeFlag ?? null,
    jobTypeMemo: first.jobTypeMemo ?? null,
    resignReasonLarge: first.resignReasonLarge ?? null,
    resignReasonMedium: first.resignReasonMedium ?? null,
    resignReasonSmall: first.resignReasonSmall ?? null,
    jobChangeReasonMemo: first.jobChangeReasonMemo ?? null,
    careerSummary: sorted
      .map((w, i) => {
        const t = [w.tenureYear != null ? `${w.tenureYear}年` : null, w.tenureMonth != null ? `${w.tenureMonth}ヶ月` : null].filter(Boolean).join("");
        return `【${i + 1}社目】${w.companyName ?? ""}（${w.businessContent ?? ""}）${t} / ${w.jobTypeFlag ?? ""}`;
      })
      .join("\n"),
  };
}

/** 働き方のチェック（JSON 文字列）を配列で */
export function workStyleListOf(detail: DetailLike): string[] {
  try {
    const raw = detail.workStylePreferences;
    const v = typeof raw === "string" && raw ? JSON.parse(raw) : Array.isArray(raw) ? raw : [];
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

/** DB / API から来た欄の値を、決まりの判定に使える形にする（Date は ISO 文字列。数値はそのまま） */
export function detailCurrentOf(detail: DetailLike, field: string): unknown {
  const v = detail[field];
  if (v instanceof Date) return v.toISOString();
  return v;
}

/** detail の欄に入れる値の型を合わせる（数値・日時） */
export function coerceDetailValue(field: string, value: string): unknown {
  if (DETAIL_NUMBER_KEYS.has(field)) {
    if (value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (DETAIL_DATETIME_KEYS.includes(field)) {
    if (value === "") return null;
    const v = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
    return normalizeDate(v);
  }
  return value === "" ? null : value;
}

/** いまの欄の値を文字で（「入力内容」タブ・提案の表示用）。日時は YYYY-MM-DD */
export function currentValueAt(path: string, detail: DetailLike, workHistories: WorkHistoryRowLike[]): string {
  const p = path.split("@")[0];
  if (p.startsWith("d.")) {
    const field = p.slice(2);
    const v = detailCurrentOf(detail, field);
    if (v == null) return "";
    if (DETAIL_DATETIME_KEYS.includes(field) && typeof v === "string") return v.slice(0, 10);
    return String(v);
  }
  if (p.startsWith("wh.")) {
    const [, idx, field] = p.split(".");
    const row = sortedRows(workHistories)[Number(idx)];
    const v = row?.[field];
    return v == null ? "" : String(v);
  }
  if (p.startsWith("ws.")) return workStyleListOf(detail).includes(p.slice(3)) ? "1" : "";
  return "";
}

function sortedRows(rows: WorkHistoryRowLike[]): WorkHistoryRowLike[] {
  return [...rows].sort((a, b) => a.order - b.order);
}

export type ApplyPlan = {
  /** interview_details に入れる値（型合わせ済み）。空なら detail は書かない */
  detailPatch: DetailLike;
  /** 会社番号（order 順の 0 始まり）→ work_histories に入れる値 */
  whPatches: Record<number, Record<string, string | null>>;
  applied: AppliedMap;
  proposals: ProposalMap;
};

/**
 * 1つの場面の書き込み（sceneWritesWithClears）から計画を作る。
 * - 欄が空のときだけ入れる／違う値があれば proposals に回す／押し直しは applied で判定（decideApply）
 * - 職歴の行が無い会社番号への書き込みは入れない（仮の会社）
 */
export function planSceneApply(
  writes: SceneWrite[],
  detail: DetailLike,
  workHistories: WorkHistoryRowLike[],
  applied: AppliedMap,
  proposals: ProposalMap,
): ApplyPlan {
  const rows = sortedRows(workHistories);
  const detailPatch: DetailLike = {};
  const whPatches: Record<number, Record<string, string | null>> = {};
  let wsList: string[] | null = null;
  let nextAppliedMap: AppliedMap = { ...applied };
  const nextProposals: ProposalMap = { ...proposals };

  for (const w of writes) {
    const prevApplied = nextAppliedMap[w.appliedKey];
    let companyIndex: number | undefined;
    let current: unknown;
    if (w.target.kind === "detail") {
      current = w.target.field in detailPatch ? detailPatch[w.target.field] : detailCurrentOf(detail, w.target.field);
    } else if (w.target.kind === "wh") {
      companyIndex = Number(w.path.split(".")[1]);
      const row = rows[companyIndex];
      if (!row) continue;
      const patch = whPatches[companyIndex];
      current = patch && w.target.field in patch ? patch[w.target.field] : row[w.target.field];
    } else {
      if (wsList === null) wsList = workStyleListOf(detail);
      current = wsList;
    }
    const dec = decideApply(w.target, companyIndex, current, prevApplied, w.value);
    if (dec.action === "propose") {
      nextProposals[w.path] = { value: dec.nextValue };
      continue;
    }
    if (dec.action === "skip") {
      if (!w.value) delete nextProposals[w.path];
      continue;
    }
    delete nextProposals[w.path];
    nextAppliedMap = nextApplied(nextAppliedMap, { ...dec, path: w.appliedKey });
    if (w.target.kind === "detail") {
      detailPatch[w.target.field] = coerceDetailValue(w.target.field, dec.nextValue);
    } else if (w.target.kind === "wh") {
      whPatches[companyIndex!] = { ...(whPatches[companyIndex!] ?? {}), [w.target.field]: dec.nextValue === "" ? null : dec.nextValue };
    } else {
      const item = w.target.item;
      wsList = dec.nextValue === "1" ? [...(wsList ?? []).filter((x) => x !== item), item] : (wsList ?? []).filter((x) => x !== item);
    }
  }
  if (wsList !== null) detailPatch.workStylePreferences = JSON.stringify(wsList);

  return { detailPatch, whPatches, applied: nextAppliedMap, proposals: nextProposals };
}

/** CA が「替える」を押した: その欄だけ提案の値にし、applied に記録して提案から外す。提案が無ければ null */
export function planAcceptProposal(
  path: string,
  workHistories: WorkHistoryRowLike[],
  applied: AppliedMap,
  proposals: ProposalMap,
): ApplyPlan | null {
  const p = proposals[path];
  if (!p) return null;
  const detailPatch: DetailLike = {};
  const whPatches: Record<number, Record<string, string | null>> = {};
  if (path.startsWith("d.")) {
    const field = path.slice(2);
    detailPatch[field] = coerceDetailValue(field, p.value);
  } else if (path.startsWith("wh.")) {
    const [, idx, field] = path.split(".");
    const companyIndex = Number(idx);
    if (!sortedRows(workHistories)[companyIndex]) return null;
    whPatches[companyIndex] = { [field]: p.value || null };
  } else {
    return null;
  }
  const nextProposals = { ...proposals };
  delete nextProposals[path];
  return { detailPatch, whPatches, applied: acceptProposal(applied, path, p.value), proposals: nextProposals };
}

/** CA が「そのまま」を押した: 提案から外すだけ */
export function planDismissProposal(path: string, proposals: ProposalMap): ProposalMap {
  const next = { ...proposals };
  delete next[path];
  return next;
}

/** 計画をメモリ上の detail / workHistories に当てた結果（確認スクリプトと、画面の楽観表示用） */
export function applyPlanToState(
  plan: ApplyPlan,
  detail: DetailLike,
  workHistories: WorkHistoryRowLike[],
): { detail: DetailLike; workHistories: WorkHistoryRowLike[] } {
  const rows = sortedRows(workHistories).map((row, i) => (plan.whPatches[i] ? { ...row, ...plan.whPatches[i] } : row));
  const nextDetail: DetailLike = { ...detail, ...plan.detailPatch };
  if (Object.keys(plan.whPatches).length > 0) Object.assign(nextDetail, detailMirrorOfWorkHistories(rows));
  return { detail: nextDetail, workHistories: rows };
}

export function hasPlanWrites(plan: ApplyPlan): boolean {
  return Object.keys(plan.detailPatch).length > 0 || Object.keys(plan.whPatches).length > 0;
}
