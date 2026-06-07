// T-071② / T-069：初回面談者の属性分布（円グラフ用）。
// 母集団＝指定レンジの初回面談（interview_count=1・辞退系除外・担当軸 candidate.employeeId）。
// 4種とも母数＝初回面談数。null は「未設定/未評価/不明」に寄せる。
//   ランク＝InterviewRating.overall_rank、性別＝candidate.gender、
//   職種希望＝interview_details.desired_job_types[0]->>'large'（第1希望の大分類）、
//   年齢層＝candidate.birthday→AGE を 6 バンド＋不明。

import { prisma } from "@/lib/prisma";
import { INTERVIEW_DECLINED_FLAGS } from "@/lib/dailyReport/constants";

const DECLINED_SQL = INTERVIEW_DECLINED_FLAGS.map((f) => `'${f}'`).join(",");

export interface InterviewAttributes {
  total: number;
  rank: Record<string, number>;
  gender: Record<string, number>;
  jobType: Record<string, number>;
  ageBand: Record<string, number>;
}

export async function computeInterviewAttributes(params: {
  employeeId: string;
  from: Date;
  to: Date;
  allCas?: boolean;
}): Promise<InterviewAttributes> {
  const { employeeId, from, to, allCas } = params;
  const F = from.toISOString().replace("T", " ").replace("Z", "");
  const T = to.toISOString().replace("T", " ").replace("Z", "");
  const empPred = allCas ? "TRUE" : `c.employee_id = '${employeeId}'`;
  const base = `
    FROM interview_records ir
    JOIN candidates c ON c.id = ir.candidate_id
    LEFT JOIN interview_details d ON d.interview_record_id = ir.id
    LEFT JOIN interview_ratings rt ON rt.interview_record_id = ir.id
    WHERE ${empPred}
      AND ir.interview_count = 1
      AND (ir.result_flag IS NULL OR ir.result_flag NOT IN (${DECLINED_SQL}))
      AND ir.interview_date >= TIMESTAMP '${F}' AND ir.interview_date <= TIMESTAMP '${T}'`;

  const [rankRows, genderRows, jobRows, ageRows, totalRows] = await Promise.all([
    prisma.$queryRawUnsafe<{ k: string; n: number }[]>(`SELECT COALESCE(NULLIF(rt.overall_rank,''),'未評価') k, COUNT(*)::int n ${base} GROUP BY 1`),
    prisma.$queryRawUnsafe<{ k: string; n: number }[]>(`SELECT COALESCE(c.gender,'未設定') k, COUNT(*)::int n ${base} GROUP BY 1`),
    prisma.$queryRawUnsafe<{ k: string; n: number }[]>(`SELECT COALESCE(d.desired_job_types->0->>'large','未設定') k, COUNT(*)::int n ${base} GROUP BY 1`),
    prisma.$queryRawUnsafe<{ k: string; n: number }[]>(`
      SELECT CASE
        WHEN age BETWEEN 20 AND 24 THEN '20代前半' WHEN age BETWEEN 25 AND 29 THEN '20代後半'
        WHEN age BETWEEN 30 AND 34 THEN '30代前半' WHEN age BETWEEN 35 AND 39 THEN '30代後半'
        WHEN age BETWEEN 40 AND 44 THEN '40代前半' WHEN age >= 45 THEN '45歳以上' ELSE '不明' END k,
        COUNT(*)::int n
      FROM (SELECT EXTRACT(YEAR FROM AGE(c.birthday))::int age ${base}) x GROUP BY 1`),
    prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int n ${base}`),
  ]);
  const toMap = (rows: { k: string; n: number }[]) => { const o: Record<string, number> = {}; for (const r of rows) o[r.k] = r.n; return o; };
  return {
    total: totalRows[0]?.n ?? 0,
    rank: toMap(rankRows),
    gender: toMap(genderRows),
    jobType: toMap(jobRows),
    ageBand: toMap(ageRows),
  };
}
