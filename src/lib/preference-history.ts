// T-XXX step5B: 希望条件（選択式の項目）の変更記録（candidate_preference_histories）。
//
// - 対象は選択式・数値・JSON（複数選択）の項目だけ。文章欄（*_memo / free_memo / career_summary など）は対象外。
// - source=interview_detail: 面談詳細（interview_details）。面談ごとに 1 行あるので、
//     * 既存の面談の編集 → その面談の保存前の値と比べる
//     * 面談の新規作成（前回の値を写して編集）→ その求職者の直前の面談の値と比べる（写しただけなら書かない）
//   source=candidate: 求職者の行（candidates.desired_*）。
// - 1 項目 1 行（field / from_value / to_value）。JSON は配列・オブジェクトを正規化した文字列にする。
// - 方針は step2 の担当CA履歴と同じ: **更新と同じトランザクションで書く**。
// - 希望条件を書き換える経路を増やしたら必ずここを呼ぶ（経路一覧は PREFERENCE_ROUTES）。

import type { Prisma, PrismaClient } from "@prisma/client";

export const PREFERENCE_ROUTES = {
  interviewCreate: "interview_create", // POST /api/interviews（面談の新規作成・detail 同時保存）
  interviewUpdate: "interview_update", // PATCH /api/interviews/[id]（面談フォームの保存）
  interviewAutosave: "interview_autosave", // PATCH /api/interviews/[id]/autosave（自動保存）
  scriptApply: "script_apply", // POST /api/interviews/[id]/script-answers/apply（台本モードからの反映）
  candidateUpdate: "candidate_update", // PATCH /api/candidates/[id]/update（求職者の基本情報編集）
} as const;

export type PreferenceRoute = (typeof PREFERENCE_ROUTES)[keyof typeof PREFERENCE_ROUTES];
export type PreferenceSource = "interview_detail" | "candidate";

type Db = PrismaClient | Prisma.TransactionClient;

/** 面談詳細（interview_details）の対象項目。選択式・数値・JSON のみ（memo 類は入れない）。 */
export const INTERVIEW_DETAIL_PREFERENCE_FIELDS = [
  // 転職活動状況
  "agentUsageFlag",
  "employmentStatus",
  "jobChangeTimeline",
  "activityPeriod",
  "currentApplicationCount",
  "applicationTypeFlag",
  // 学歴・経験（区分）
  "educationFlag",
  "graduationStatus",
  "jobTypeFlag",
  "resignReasonLarge",
  "resignReasonMedium",
  "resignReasonSmall",
  "jobChangeAxisFlag",
  // 希望条件
  "desiredJobType1",
  "desiredJobType2",
  "desiredJobTypes",
  "desiredEmploymentType",
  "desiredIndustry1",
  "desiredIndustries",
  "desiredAreas",
  "desiredArea",
  "desiredPrefecture",
  "desiredCity",
  "currentSalary",
  "desiredSalaryMin",
  "desiredSalaryMax",
  "desiredDayOff",
  "desiredHolidayCount",
  "desiredOvertimeMax",
  "desiredTransfer",
  "workStyleFlags",
  "companyFeatureFlags",
  "priorityCondition1",
  "priorityCondition2",
  "priorityCondition3",
] as const;

/** 求職者の行（candidates）の対象項目。 */
export const CANDIDATE_PREFERENCE_FIELDS = [
  "desiredJobType1",
  "desiredJobType2",
  "desiredIndustry1",
  "desiredIndustry2",
  "desiredPrefecture1",
  "desiredPrefecture2",
  "desiredEmploymentType",
  "desiredSalaryMin",
] as const;

/** 値を比較・保存用の文字列に正規化する（null / 空文字 / undefined は null）。 */
export function normalizePreferenceValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (Array.isArray(v)) {
    const items = v.map(normalizePreferenceValue).filter((x): x is string => x != null);
    return items.length === 0 ? null : JSON.stringify(items);
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    if (keys.length === 0) return null;
    return JSON.stringify(Object.fromEntries(keys.map((k) => [k, o[k]])));
  }
  return String(v);
}

export interface PreferenceFieldChange {
  field: string;
  fromValue: string | null;
  toValue: string | null;
}

/**
 * patch に含まれる項目のうち対象項目だけを before と比べる（patch に無い項目は「変更なし」）。
 * before が null（比べる元が無い）のときは、patch の値が空でない項目を from=null として返す。
 */
export function diffPreferenceFields(
  fields: readonly string[],
  before: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): PreferenceFieldChange[] {
  const out: PreferenceFieldChange[] = [];
  for (const f of fields) {
    if (!(f in patch)) continue;
    const to = normalizePreferenceValue(patch[f]);
    const from = before ? normalizePreferenceValue(before[f]) : null;
    if (from === to) continue;
    out.push({ field: f, fromValue: from, toValue: to });
  }
  return out;
}

export interface PreferenceChangeSet {
  candidateId: string;
  source: PreferenceSource;
  interviewRecordId: string | null;
  changes: PreferenceFieldChange[];
  changedByUserId: string | null;
  route: PreferenceRoute;
}

/** 変化のある項目だけを追記し、件数を返す。 */
export async function recordPreferenceChanges(db: Db, set: PreferenceChangeSet): Promise<number> {
  if (set.changes.length === 0) return 0;
  const res = await db.candidatePreferenceHistory.createMany({
    data: set.changes.map((c) => ({
      candidateId: set.candidateId,
      source: set.source,
      interviewRecordId: set.interviewRecordId,
      field: c.field,
      fromValue: c.fromValue,
      toValue: c.toValue,
      changedByUserId: set.changedByUserId,
      route: set.route,
    })),
  });
  return res.count;
}

/**
 * 面談詳細の比較元を読む: その面談の既存の detail → 無ければ同じ求職者の直前の面談（面談日の新しい順）の detail → 無ければ null。
 */
export async function loadInterviewDetailBaseline(
  db: Db,
  params: { interviewRecordId: string; candidateId: string },
): Promise<Record<string, unknown> | null> {
  const own = await db.interviewDetail.findUnique({ where: { interviewRecordId: params.interviewRecordId } });
  if (own) return own as unknown as Record<string, unknown>;
  const prev = await db.interviewRecord.findFirst({
    where: { candidateId: params.candidateId, id: { not: params.interviewRecordId }, detail: { isNot: null } },
    orderBy: [{ interviewDate: "desc" }, { createdAt: "desc" }],
    select: { detail: true },
  });
  return (prev?.detail as unknown as Record<string, unknown> | null) ?? null;
}

/**
 * 面談詳細の保存（upsert / create）に合わせて記録する。baseline は loadInterviewDetailBaseline で保存前に読んでおく。
 */
export async function recordInterviewDetailPreferenceChanges(
  db: Db,
  params: {
    candidateId: string;
    interviewRecordId: string;
    baseline: Record<string, unknown> | null;
    patch: Record<string, unknown>;
    changedByUserId: string | null;
    route: PreferenceRoute;
  },
): Promise<number> {
  const changes = diffPreferenceFields(INTERVIEW_DETAIL_PREFERENCE_FIELDS, params.baseline, params.patch);
  return recordPreferenceChanges(db, {
    candidateId: params.candidateId,
    source: "interview_detail",
    interviewRecordId: params.interviewRecordId,
    changes,
    changedByUserId: params.changedByUserId,
    route: params.route,
  });
}

/** 求職者の行（candidates.desired_*）の保存に合わせて記録する。 */
export async function recordCandidatePreferenceChanges(
  db: Db,
  params: {
    candidateId: string;
    before: Record<string, unknown>;
    patch: Record<string, unknown>;
    changedByUserId: string | null;
    route: PreferenceRoute;
  },
): Promise<number> {
  const changes = diffPreferenceFields(CANDIDATE_PREFERENCE_FIELDS, params.before, params.patch);
  return recordPreferenceChanges(db, {
    candidateId: params.candidateId,
    source: "candidate",
    interviewRecordId: null,
    changes,
    changedByUserId: params.changedByUserId,
    route: params.route,
  });
}
