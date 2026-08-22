// 配信計画（RpaScoutPlan）から実績ログ（RpaScoutLog）を作る処理の共通化。
// 画面の「実績として記録」（POST /api/rpa-scout/plans/[id]/execute）と、
// RPA の反映書き込み（PATCH /api/external/scout-plan/[id]/reflect）とで
// ログの形（号機・パターン・件名のスナップショットの引き継ぎ方）を必ず一致させるため、
// ログ生成はこの1箇所だけで行う。
import type { Prisma } from "@prisma/client";

// 計画からログへ引き継ぐスナップショット項目
type PlanSnapshot = {
  machineNo: number;
  patternId: string | null;
  patternName: string;
  subjectTemplateId: string | null;
  subjectName: string;
};

export type PlanLogInput = {
  searchCount: number | null; // null=停止記録（件数なし）
  recordedAt: Date; // JST壁時計値をそのまま保持（罠#17）
  recordedByUserId: string | null; // null=RPA自動
};

export function buildPlanLogData(
  plan: PlanSnapshot,
  input: PlanLogInput
): Prisma.RpaScoutLogUncheckedCreateInput {
  return {
    machineNo: plan.machineNo,
    patternId: plan.patternId,
    patternName: plan.patternName, // 計画のスナップショットをそのまま引き継ぐ
    subjectTemplateId: plan.subjectTemplateId,
    subjectName: plan.subjectName,
    searchCount: input.searchCount,
    recordedAt: input.recordedAt,
    recordedByUserId: input.recordedByUserId,
  };
}

export function createLogFromPlan(
  tx: Prisma.TransactionClient,
  plan: PlanSnapshot,
  input: PlanLogInput
) {
  return tx.rpaScoutLog.create({ data: buildPlanLogData(plan, input) });
}
