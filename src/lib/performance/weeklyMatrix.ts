// T-071 FileMaker 形 週マトリクスの集計。computeCaMetricsForRange は変更せず、
// 新規/既存の区別・件数/人数/1人当たり・選考状況（決定売上等）を raw SQL で算出する。
//
// 数え方（T-071 確定を踏襲）：
//   - 担当軸＝candidate.employeeId（面談・エントリー・選考状況）、求人紹介は uploadedByUserId（User.id）。
//   - 無効（isActive=false）含む・アーカイブ（archivedAt）除く。
//   - 件数＝レコード件数、人数＝候補者ユニーク、1人当たり＝件数÷人数。
//   - 新規/既存：その候補者にとっての「初回」提案/エントリーかどうか（最初の日付がレンジ内なら新規）。
//   - 面談は notDeclined（辞退系以外、null 含む）でカウント。
//   - JST 境界は呼び出し側が from/to(Date) で渡す（罠 #17）。列は UTC 保存なので UTC wall-clock で比較。

import { prisma } from "@/lib/prisma";
import { INTERVIEW_DECLINED_FLAGS } from "@/lib/dailyReport/constants";

export interface CountUniqPer {
  recs: number; // 件数
  uniq: number; // 人数（候補者ユニーク）
  perPerson: number | null; // 1人当たり = 件数 ÷ 人数
}

export interface WeeklyMatrix {
  interview: { first: number; second: number; thirdPlus: number; total: number };
  proposal: { fresh: CountUniqPer; existing: CountUniqPer; total: CountUniqPer };
  entry: { fresh: CountUniqPer; existing: CountUniqPer; total: CountUniqPer };
  selection: {
    documentPass: number; // 人数
    offer: number;
    acceptance: number;
    decidedRevenue: number | null;
    decidedUnitPrice: number | null;
  };
}

// timestamp(無tz, UTC 保存) 列と比較するための UTC wall-clock リテラル。
function tsLit(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}
function per(recs: number, uniq: number): number | null {
  return uniq > 0 ? recs / uniq : null;
}
const DECLINED_SQL = INTERVIEW_DECLINED_FLAGS.map((f) => `'${f}'`).join(",");

export async function computeWeeklyMatrix(params: {
  employeeId: string;
  userId: string;
  from: Date;
  to: Date;
}): Promise<WeeklyMatrix> {
  const { employeeId, userId, from, to } = params;
  const F = tsLit(from);
  const T = tsLit(to);

  const [iv, prop, ent, sel] = await Promise.all([
    // 面談（candidate.employeeId 軸・notDeclined）。second は予約語のため別名にする。
    prisma.$queryRawUnsafe<{ iv_first: number; iv_second: number; iv_third: number; iv_total: number }[]>(`
      SELECT
        COUNT(*) FILTER (WHERE ir.interview_count = 1)::int iv_first,
        COUNT(*) FILTER (WHERE ir.interview_count = 2)::int iv_second,
        COUNT(*) FILTER (WHERE ir.interview_count >= 3)::int iv_third,
        COUNT(*) FILTER (WHERE ir.interview_count >= 1)::int iv_total
      FROM interview_records ir JOIN candidates c ON c.id = ir.candidate_id
      WHERE c.employee_id = '${employeeId}'
        AND (ir.result_flag IS NULL OR ir.result_flag NOT IN (${DECLINED_SQL}))
        AND ir.interview_date >= TIMESTAMP '${F}' AND ir.interview_date <= TIMESTAMP '${T}';`),

    // 求人紹介（CandidateFile BOOKMARK・uploadedByUserId 軸）。新規＝その候補者の初回提案がレンジ内。
    prisma.$queryRawUnsafe<{ new_recs: number; new_uniq: number; ex_recs: number; ex_uniq: number; tot_recs: number; tot_uniq: number }[]>(`
      WITH props AS (
        SELECT cf.candidate_id, cf.last_exported_at,
          MIN(cf.last_exported_at) OVER (PARTITION BY cf.candidate_id) AS first_export
        FROM candidate_files cf
        WHERE cf.category = 'BOOKMARK' AND cf.uploaded_by_user_id = '${userId}' AND cf.last_exported_at IS NOT NULL
      )
      SELECT
        COUNT(*) FILTER (WHERE last_exported_at BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_export >= TIMESTAMP '${F}')::int new_recs,
        COUNT(DISTINCT candidate_id) FILTER (WHERE last_exported_at BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_export >= TIMESTAMP '${F}')::int new_uniq,
        COUNT(*) FILTER (WHERE last_exported_at BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_export < TIMESTAMP '${F}')::int ex_recs,
        COUNT(DISTINCT candidate_id) FILTER (WHERE last_exported_at BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_export < TIMESTAMP '${F}')::int ex_uniq,
        COUNT(*) FILTER (WHERE last_exported_at BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int tot_recs,
        COUNT(DISTINCT candidate_id) FILTER (WHERE last_exported_at BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int tot_uniq
      FROM props;`),

    // エントリー（JobEntry・candidate.employeeId 軸・post-app・archived除く）。新規＝その候補者の初回エントリーがレンジ内。
    prisma.$queryRawUnsafe<{ new_recs: number; new_uniq: number; ex_recs: number; ex_uniq: number; tot_recs: number; tot_uniq: number }[]>(`
      WITH ents AS (
        SELECT je.candidate_id, je.entry_date,
          MIN(je.entry_date) OVER (PARTITION BY je.candidate_id) AS first_entry
        FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
        WHERE c.employee_id = '${employeeId}' AND je.archived_at IS NULL
          AND je.entry_flag IN ('応募','エントリー','書類選考','面接','内定','入社済')
      )
      SELECT
        COUNT(*) FILTER (WHERE entry_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_entry >= TIMESTAMP '${F}')::int new_recs,
        COUNT(DISTINCT candidate_id) FILTER (WHERE entry_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_entry >= TIMESTAMP '${F}')::int new_uniq,
        COUNT(*) FILTER (WHERE entry_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_entry < TIMESTAMP '${F}')::int ex_recs,
        COUNT(DISTINCT candidate_id) FILTER (WHERE entry_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_entry < TIMESTAMP '${F}')::int ex_uniq,
        COUNT(*) FILTER (WHERE entry_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int tot_recs,
        COUNT(DISTINCT candidate_id) FILTER (WHERE entry_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int tot_uniq
      FROM ents;`),

    // 選考状況（JobEntry・candidate.employeeId 軸・archived除く・候補者ユニーク人数＋決定売上）
    prisma.$queryRawUnsafe<{ dp: number; ofc: number; ac: number; revenue: string | null }[]>(`
      SELECT
        COUNT(DISTINCT je.candidate_id) FILTER (WHERE je.document_pass_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int dp,
        COUNT(DISTINCT je.candidate_id) FILTER (WHERE je.offer_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int ofc,
        COUNT(DISTINCT je.candidate_id) FILTER (WHERE je.acceptance_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int ac,
        COALESCE(SUM(je.revenue) FILTER (WHERE je.acceptance_date BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}'), 0)::bigint revenue
      FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
      WHERE c.employee_id = '${employeeId}' AND je.archived_at IS NULL;`),
  ]);

  const i = iv[0];
  const pr = prop[0];
  const en = ent[0];
  const s = sel[0];

  const revenue = s.revenue != null ? Number(s.revenue) : 0;
  const decidedRevenue = revenue > 0 ? revenue : null;
  const decidedUnitPrice = decidedRevenue != null && s.ac > 0 ? decidedRevenue / s.ac : null;

  return {
    interview: { first: i.iv_first, second: i.iv_second, thirdPlus: i.iv_third, total: i.iv_total },
    proposal: {
      fresh: { recs: pr.new_recs, uniq: pr.new_uniq, perPerson: per(pr.new_recs, pr.new_uniq) },
      existing: { recs: pr.ex_recs, uniq: pr.ex_uniq, perPerson: per(pr.ex_recs, pr.ex_uniq) },
      total: { recs: pr.tot_recs, uniq: pr.tot_uniq, perPerson: per(pr.tot_recs, pr.tot_uniq) },
    },
    entry: {
      fresh: { recs: en.new_recs, uniq: en.new_uniq, perPerson: per(en.new_recs, en.new_uniq) },
      existing: { recs: en.ex_recs, uniq: en.ex_uniq, perPerson: per(en.ex_recs, en.ex_uniq) },
      total: { recs: en.tot_recs, uniq: en.tot_uniq, perPerson: per(en.tot_recs, en.tot_uniq) },
    },
    selection: {
      documentPass: s.dp,
      offer: s.ofc,
      acceptance: s.ac,
      decidedRevenue,
      decidedUnitPrice,
    },
  };
}
