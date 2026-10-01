// T-XXX step2: 担当CA（Candidate.employeeId）の変更記録。
//
// - 担当CAが変わる保存のたびに CandidateCaAssignmentHistory へ 1 行追記する（追加のみ・更新しない）。
// - 担当が変わらない保存（同じCAで再保存・担当以外の項目だけの編集）では書かない。
// - 書き込みはこのファイルに集約する。担当CAを書き換える経路を増やしたら必ずここを呼ぶ:
//     candidate_update        … 求職者詳細の基本情報編集（PATCH /api/candidates/[id]/update）
//     bulk_change_assignee    … 求職者一覧の一括「担当CA変更」（POST /api/master/candidates/bulk-update）
//     candidate_create        … 新規登録で担当CAを付けたとき（POST /api/master/candidates）
//     initial_snapshot        … 記録開始時の「今の担当CA」スナップショット（マイグレーション 20261001100000 のみ）
// - 候補者の更新と同じトランザクション（tx）で呼ぶこと。履歴の書き込みに失敗したら担当の変更も戻る。

import type { Prisma, PrismaClient } from "@prisma/client";

export const CA_ASSIGNMENT_ROUTES = {
  candidateUpdate: "candidate_update",
  bulkChangeAssignee: "bulk_change_assignee",
  candidateCreate: "candidate_create",
  initialSnapshot: "initial_snapshot",
} as const;

export type CaAssignmentRoute = (typeof CA_ASSIGNMENT_ROUTES)[keyof typeof CA_ASSIGNMENT_ROUTES];

type Db = PrismaClient | Prisma.TransactionClient;

export interface CaAssignmentChange {
  candidateId: string;
  fromEmployeeId: string | null | undefined;
  toEmployeeId: string | null | undefined;
  changedByUserId: string | null;
  route: CaAssignmentRoute;
}

/** 担当CAが変わったか（undefined / null / "" はすべて「担当なし」とみなす）。 */
export function caAssignmentChanged(
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  return (from || null) !== (to || null);
}

/**
 * 担当CAが変わった場合だけ 1 行追記する。変わらなければ何もせず false を返す。
 */
export async function recordCaAssignmentChange(db: Db, change: CaAssignmentChange): Promise<boolean> {
  if (!caAssignmentChanged(change.fromEmployeeId, change.toEmployeeId)) return false;
  await db.candidateCaAssignmentHistory.create({
    data: {
      candidateId: change.candidateId,
      fromEmployeeId: change.fromEmployeeId || null,
      toEmployeeId: change.toEmployeeId || null,
      changedByUserId: change.changedByUserId,
      route: change.route,
    },
  });
  return true;
}

/**
 * 複数件（一括変更）。担当が変わる行だけをまとめて追記し、追記した件数を返す。
 */
export async function recordCaAssignmentChanges(db: Db, changes: CaAssignmentChange[]): Promise<number> {
  const rows = changes
    .filter((c) => caAssignmentChanged(c.fromEmployeeId, c.toEmployeeId))
    .map((c) => ({
      candidateId: c.candidateId,
      fromEmployeeId: c.fromEmployeeId || null,
      toEmployeeId: c.toEmployeeId || null,
      changedByUserId: c.changedByUserId,
      route: c.route,
    }));
  if (rows.length === 0) return 0;
  const res = await db.candidateCaAssignmentHistory.createMany({ data: rows });
  return res.count;
}
