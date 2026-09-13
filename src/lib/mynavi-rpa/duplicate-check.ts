import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * 二重処理スキップを表す処理ログ status。
 * 旧値 "DUPLICATE_SKIP"（〜2026-09-06）と新値 "DUPLICATE_SKIPPED" の両方を扱う。
 */
export const DUPLICATE_SKIP_STATUSES = ["DUPLICATE_SKIP", "DUPLICATE_SKIPPED"] as const;

export type DuplicateProcessingHit = Prisma.MynaviRpaProcessingLogGetPayload<{
  include: {
    candidate: { select: { id: true; candidateNumber: true; name: true; supportStatus: true } };
  };
}>;

/**
 * 直近 windowMinutes 分以内に「同一電話番号で実際に求職者登録された処理ログ」があるかを判定する。
 *
 * 判定対象に含めるのは次を全て満たすログのみ:
 *   - phoneNormalized が一致し processedAt が窓内
 *   - status が二重処理スキップ以外（スキップ自身が窓を延長しないように）
 *   - candidateId が非 null（hard-delete は onDelete: SetNull で candidateId が消える＝自動的に除外）
 *   - 紐づく Candidate が supportStatus != "ARCHIVED"（アーカイブ済みは除外）
 *
 * Candidate に soft delete カラムは無い（削除は hard-delete のみ）ため、
 * 「削除済み求職者に紐づくログ」は candidateId IS NULL の条件で除外される。
 * AI_FAILED / ERROR のログは candidateId が null なので同じく対象外（登録されていないので再処理してよい）。
 *
 * @returns ヒットした処理ログ（既存求職者付き）。なければ null
 */
export async function checkDuplicateProcessing(
  phoneNormalized: string,
  windowMinutes = 30,
): Promise<DuplicateProcessingHit | null> {
  if (!phoneNormalized) return null;

  const since = new Date(Date.now() - windowMinutes * 60 * 1000);

  return prisma.mynaviRpaProcessingLog.findFirst({
    where: {
      phoneNormalized,
      processedAt: { gte: since },
      status: { notIn: [...DUPLICATE_SKIP_STATUSES] },
      candidateId: { not: null },
      candidate: { is: { supportStatus: { not: "ARCHIVED" } } },
    },
    include: {
      candidate: {
        select: { id: true, candidateNumber: true, name: true, supportStatus: true },
      },
    },
    orderBy: { processedAt: "desc" },
  });
}
