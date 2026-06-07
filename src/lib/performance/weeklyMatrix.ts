// T-071 FileMaker 形 週マトリクスの集計。computeCaMetricsForRange は変更せず、
// 新規/既存の区別・件数/人数/1人当たり・選考状況（決定売上等）を raw SQL で算出する。
//
// 数え方（T-071 確定を踏襲）：
//   - 担当軸＝candidate.employeeId（面談・エントリー・選考状況・**求人紹介も統一**）。
//   - 求人紹介（提案）は **JobEntry.jobIntroDate ∪ CandidateFile BOOKMARK.lastExportedAt** の両ソース統合
//     （記録方式が 2026/4 に移行。片方だけでは過去 or 現在が欠ける）。candidate×同日のクロスソース重複は除外。
//   - 無効（isActive=false）含む・アーカイブ（archivedAt）除く。
//   - 件数＝レコード件数、人数＝候補者ユニーク、1人当たり＝件数÷人数。
//   - 新規/既存：その候補者の**通算最古日（MIN）がレンジ内なら新規・レンジ前なら既存**（提案・エントリーとも候補者単位で排他。初回+既存=合計）。
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
  allCas?: boolean; // true なら全CA合算（担当・User フィルタを外す。数え方は同じ）
}): Promise<WeeklyMatrix> {
  const { employeeId, userId, from, to, allCas } = params;
  const F = tsLit(from);
  const T = tsLit(to);
  // 全員モードでは担当軸フィルタを外す（対象を全候補者に広げるだけ）。
  const empPred = allCas ? "TRUE" : `c.employee_id = '${employeeId}'`;
  void userId; // 求人紹介も candidate.employeeId 軸に統一したため User.id は未使用（signature は後方互換で維持）。

  const [iv, prop, ent, sel] = await Promise.all([
    // 面談（candidate.employeeId 軸・notDeclined）。second は予約語のため別名にする。
    prisma.$queryRawUnsafe<{ iv_first: number; iv_second: number; iv_third: number; iv_total: number }[]>(`
      SELECT
        COUNT(*) FILTER (WHERE ir.interview_count = 1)::int iv_first,
        COUNT(*) FILTER (WHERE ir.interview_count = 2)::int iv_second,
        COUNT(*) FILTER (WHERE ir.interview_count >= 3)::int iv_third,
        COUNT(*) FILTER (WHERE ir.interview_count >= 1)::int iv_total
      FROM interview_records ir JOIN candidates c ON c.id = ir.candidate_id
      WHERE ${empPred}
        AND (ir.result_flag IS NULL OR ir.result_flag NOT IN (${DECLINED_SQL}))
        AND ir.interview_date >= TIMESTAMP '${F}' AND ir.interview_date <= TIMESTAMP '${T}';`),

    // 求人紹介（提案）＝両ソース統合：JobEntry.jobIntroDate（旧・〜2026/4）∪ CandidateFile BOOKMARK.lastExportedAt（新・2026/4〜）。
    // 担当はどちらも candidate.employeeId 軸に統一。無効含む・archivedAt 除く（JobEntry）。
    // 移行期の二重記録ガード：同一候補者×同一日に JE 提案があれば CF 側は同一提案とみなし除外（NOT EXISTS）。
    //   ※実データ検証で同日クロスソース衝突は 0 件のため現状は no-op だが、移行重複の保険。
    // 初回/既存は統合イベントの候補者**通算最古日（MIN(pdate)）が基準**＝entry と同型（候補者単位で排他）。
    //   first_p >= F：その候補者の初回提案がレンジ内＝新規候補者／first_p < F：レンジ前に初回、レンジ内で再提案＝既存候補者。
    //   ⚠️ ROW_NUMBER（rn=1/rn>1・イベント単位）方式は、1人月20件の提案があると新規候補者も同月に2件目以降を持ち
    //      「初回にも既存にも二重計上」され、既存≒合計になる誤り（T-071 修正①で MIN 方式へ）。
    prisma.$queryRawUnsafe<{ new_recs: number; new_uniq: number; ex_recs: number; ex_uniq: number; tot_recs: number; tot_uniq: number }[]>(`
      WITH events AS (
        SELECT je.candidate_id, je.job_intro_date AS pdate
        FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
        WHERE ${empPred} AND je.archived_at IS NULL AND je.job_intro_date IS NOT NULL
        UNION ALL
        SELECT cf.candidate_id, cf.last_exported_at AS pdate
        FROM candidate_files cf JOIN candidates c ON c.id = cf.candidate_id
        WHERE ${empPred} AND cf.category = 'BOOKMARK' AND cf.last_exported_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM job_entries je2
            WHERE je2.candidate_id = cf.candidate_id AND je2.archived_at IS NULL AND je2.job_intro_date IS NOT NULL
              AND (je2.job_intro_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date
                = (cf.last_exported_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date
          )
      ),
      props AS (
        SELECT candidate_id, pdate, MIN(pdate) OVER (PARTITION BY candidate_id) AS first_p
        FROM events
      )
      SELECT
        COUNT(*) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_p >= TIMESTAMP '${F}')::int new_recs,
        COUNT(DISTINCT candidate_id) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_p >= TIMESTAMP '${F}')::int new_uniq,
        COUNT(*) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_p < TIMESTAMP '${F}')::int ex_recs,
        COUNT(DISTINCT candidate_id) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}' AND first_p < TIMESTAMP '${F}')::int ex_uniq,
        COUNT(*) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int tot_recs,
        COUNT(DISTINCT candidate_id) FILTER (WHERE pdate BETWEEN TIMESTAMP '${F}' AND TIMESTAMP '${T}')::int tot_uniq
      FROM props;`),

    // エントリー（JobEntry・candidate.employeeId 軸・post-app・archived除く）。新規＝その候補者の初回エントリーがレンジ内。
    prisma.$queryRawUnsafe<{ new_recs: number; new_uniq: number; ex_recs: number; ex_uniq: number; tot_recs: number; tot_uniq: number }[]>(`
      WITH ents AS (
        SELECT je.candidate_id, je.entry_date,
          MIN(je.entry_date) OVER (PARTITION BY je.candidate_id) AS first_entry
        FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
        WHERE ${empPred} AND je.archived_at IS NULL
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
      WHERE ${empPred} AND je.archived_at IS NULL;`),
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

// 面談ランク割合（円グラフ用）。マトリクスの「**初回面談**」と同条件（担当軸・到達ベース・実施判定・interview_count=1）で
// InterviewRating.overallRank 別に集計。未評価（rating なし or rank null）は '未評価' に寄せる。
// 返り値の合計＝マトリクスの初回面談数（interview.first）と一致する。
// 目的：その期間に新規で会った人の質（ランク）の分布。求人/既存（2回目以降）は再面談で評価が重複するため除外。
export async function computeInterviewRankBreakdown(params: {
  employeeId: string;
  from: Date;
  to: Date;
  allCas?: boolean;
}): Promise<Record<string, number>> {
  const { employeeId, from, to, allCas } = params;
  const F = tsLit(from);
  const T = tsLit(to);
  const empPred = allCas ? "TRUE" : `c.employee_id = '${employeeId}'`;
  const rows = await prisma.$queryRawUnsafe<{ rk: string; n: number }[]>(`
    SELECT COALESCE(NULLIF(rt.overall_rank, ''), '未評価') AS rk, COUNT(*)::int n
    FROM interview_records ir
    JOIN candidates c ON c.id = ir.candidate_id
    LEFT JOIN interview_ratings rt ON rt.interview_record_id = ir.id
    WHERE ${empPred}
      AND (ir.result_flag IS NULL OR ir.result_flag NOT IN (${DECLINED_SQL}))
      AND ir.interview_count = 1
      AND ir.interview_date >= TIMESTAMP '${F}' AND ir.interview_date <= TIMESTAMP '${T}'
    GROUP BY COALESCE(NULLIF(rt.overall_rank, ''), '未評価');`);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.rk] = r.n;
  return out;
}
