// T-190: 実績表（computeWeeklyMatrix）に無い「企業面接数」だけを補う読み取り専用の集計。
//
// 人数系・決定売上は computeWeeklyMatrix をそのまま呼ぶ（正本を二重実装しない）。
// 企業面接は JobEntry の一次/二次/最終面接日で、実績表の選考状況クエリと **同じ述語**
// （candidate.employee_id 軸・je.archived_at IS NULL）を使い、求職者ユニーク人数を数える。
// 日付列は timestamp(無tz・UTC 保存)なので weeklyMatrix.ts と同じく UTC wall-clock リテラルで比較する。

import { prisma } from "@/lib/prisma";

function tsLit(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * 企業面接（一次・二次・最終のいずれか）の実施日が期間内にある求職者のユニーク人数。
 * 同一求職者が複数社・複数段階の面接を持っても 1 人として数える。
 */
export async function countCompanyInterviewCandidates(params: {
  employeeId: string;
  from: Date;
  to: Date;
  allCas?: boolean;
}): Promise<number> {
  const { employeeId, from, to, allCas } = params;
  const F = tsLit(from);
  const T = tsLit(to);
  const empPred = allCas ? "TRUE" : `c.employee_id = '${employeeId}'`;
  const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(`
    SELECT COUNT(DISTINCT je.candidate_id)::int AS n
    FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
    WHERE ${empPred} AND je.archived_at IS NULL
      AND (
        (je.first_interview_date  BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}') OR
        (je.second_interview_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}') OR
        (je.final_interview_date  BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')
      );`);
  return rows[0]?.n ?? 0;
}

/**
 * 請求売上（税抜）。承諾日が期間内の JobEntry の SUM(revenue)。
 * 述語は computeWeeklyMatrix の選考状況クエリ（decidedRevenue の母集団）と完全に同一：
 *   担当軸 = candidate.employee_id / je.archived_at IS NULL / je.acceptance_date BETWEEN [from,to]。
 * 粗利（decidedRevenue）は同じ母集団に対する SUM(revenue - job_db_cost - cost) なので、
 * 両者は同じ行集合から算出される（差は控除分のみ）。
 */
export async function sumInvoiceRevenue(params: {
  employeeId: string;
  from: Date;
  to: Date;
  allCas?: boolean;
}): Promise<number> {
  const { employeeId, from, to, allCas } = params;
  const F = tsLit(from);
  const T = tsLit(to);
  const empPred = allCas ? "TRUE" : `c.employee_id = '${employeeId}'`;
  const rows = await prisma.$queryRawUnsafe<{ v: string | null }[]>(`
    SELECT COALESCE(SUM(je.revenue) FILTER (WHERE je.acceptance_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}'), 0)::bigint v
    FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
    WHERE ${empPred} AND je.archived_at IS NULL;`);
  return rows[0]?.v != null ? Number(rows[0].v) : 0;
}
