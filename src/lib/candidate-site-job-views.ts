// T-189 追加: 候補者サイト向け API の「既読（本人が求人詳細を開いたか）」判定を共通化する。
//
// 既読の記録経路は candidate_activity_logs の JOB_VIEW（job_ref = CandidateFile.externalJobRef）。
// 本人セッションの閲覧のみ記録され、CA プレビューは記録しない（記録側の責務）。
// 新着マッチ（auto-matches）と担当CAおすすめ（favorites）の両方が同じ判定を使うため、
// クエリはここ 1 か所に置き、複製しない。
//
// N+1 回避: 候補者単位で JOB_VIEW を一括取得し、呼び出し側は Set で突合する。
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** 当該候補者が詳細を開いたことのある求人の externalJobRef 集合（distinct）。 */
export async function fetchViewedJobRefs(candidateId: string): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ job_ref: string }[]>(Prisma.sql`
    SELECT DISTINCT job_ref FROM candidate_activity_logs
    WHERE event_type = 'JOB_VIEW' AND job_ref IS NOT NULL AND candidate_id = ${candidateId}
  `);
  return new Set(rows.map((r) => r.job_ref));
}

/** 1 行分の既読判定（externalJobRef が無い行＝PDF行は常に false）。 */
export function isJobRefViewed(externalJobRef: string | null, viewed: Set<string>): boolean {
  return !!externalJobRef && viewed.has(externalJobRef);
}
