// T-XXX step5B: 支援状況の変更記録（candidate_support_status_histories）。
//
// - 対象の列: candidates.support_status / support_sub_status / support_end_reason / support_end_date。
//   活動開始（BEFORE→ACTIVE）・待機・終了・アーカイブ・再開（ENDED→ACTIVE など）と、中項目の自動再計算の推移が残る。
// - 変わる保存のたびに 1 行追記する（追加のみ）。変わらない保存では書かない。求職者の新規登録（既定 BEFORE）は記録しない。
// - 方針は step2 の担当CA履歴と同じ: **更新と同じトランザクションで書く**（記録に失敗したら本体の更新も戻る）。
// - 支援状況を書き換える経路を増やしたら必ずここを呼ぶ（経路一覧は SUPPORT_STATUS_ROUTES）。

import type { Prisma, PrismaClient } from "@prisma/client";

export const SUPPORT_STATUS_ROUTES = {
  candidateUpdate: "candidate_update", // PATCH /api/candidates/[id]/update（基本情報編集）
  bulkArchive: "bulk_archive", // POST /api/master/candidates/bulk-update action=archive
  bulkChangeStatus: "bulk_change_status", // POST /api/master/candidates/bulk-update action=change_status
  interviewResult: "interview_result", // 面談結果（result_flag）からの自動反映（src/lib/interview-result-to-status.ts）
  subStatusAuto: "sub_status_auto", // 中項目の自動再計算（src/lib/support-sub-status.ts recalculateSubStatusIfAuto）
} as const;

export type SupportStatusRoute = (typeof SUPPORT_STATUS_ROUTES)[keyof typeof SUPPORT_STATUS_ROUTES];

type Db = PrismaClient | Prisma.TransactionClient;

export const SUPPORT_STATUS_SELECT = {
  id: true,
  supportStatus: true,
  supportSubStatus: true,
  supportEndReason: true,
  supportEndDate: true,
} as const;

export interface SupportStatusSnapshot {
  supportStatus: string | null;
  supportSubStatus: string | null;
  supportEndReason: string | null;
  supportEndDate: Date | null;
}

const norm = (v: string | null | undefined): string | null => (v == null || v === "" ? null : v);
const sameDate = (a: Date | null | undefined, b: Date | null | undefined): boolean => (a?.getTime() ?? null) === (b?.getTime() ?? null);

export function supportStatusChangedFields(before: SupportStatusSnapshot, after: SupportStatusSnapshot): string[] {
  const out: string[] = [];
  if (norm(before.supportStatus) !== norm(after.supportStatus)) out.push("supportStatus");
  if (norm(before.supportSubStatus) !== norm(after.supportSubStatus)) out.push("supportSubStatus");
  if (norm(before.supportEndReason) !== norm(after.supportEndReason)) out.push("supportEndReason");
  if (!sameDate(before.supportEndDate, after.supportEndDate)) out.push("supportEndDate");
  return out;
}

export interface SupportStatusChange {
  candidateId: string;
  before: SupportStatusSnapshot;
  after: SupportStatusSnapshot;
  changedByUserId: string | null;
  route: SupportStatusRoute;
}

function toRow(c: SupportStatusChange): Prisma.CandidateSupportStatusHistoryCreateManyInput | null {
  const changedFields = supportStatusChangedFields(c.before, c.after);
  if (changedFields.length === 0) return null;
  return {
    candidateId: c.candidateId,
    fromSupportStatus: norm(c.before.supportStatus),
    toSupportStatus: norm(c.after.supportStatus),
    fromSupportSubStatus: norm(c.before.supportSubStatus),
    toSupportSubStatus: norm(c.after.supportSubStatus),
    fromSupportEndReason: norm(c.before.supportEndReason),
    toSupportEndReason: norm(c.after.supportEndReason),
    fromSupportEndDate: c.before.supportEndDate ?? null,
    toSupportEndDate: c.after.supportEndDate ?? null,
    changedFields,
    changedByUserId: c.changedByUserId,
    route: c.route,
  };
}

/** 1 件。変化が無ければ何も書かず false を返す。 */
export async function recordSupportStatusChange(db: Db, change: SupportStatusChange): Promise<boolean> {
  const row = toRow(change);
  if (!row) return false;
  await db.candidateSupportStatusHistory.create({ data: row });
  return true;
}

/** 複数件。変化のある行だけをまとめて追記し、追記した件数を返す。 */
export async function recordSupportStatusChanges(db: Db, changes: SupportStatusChange[]): Promise<number> {
  const rows = changes.map(toRow).filter((r): r is Prisma.CandidateSupportStatusHistoryCreateManyInput => r != null);
  if (rows.length === 0) return 0;
  const res = await db.candidateSupportStatusHistory.createMany({ data: rows });
  return res.count;
}
