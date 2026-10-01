// T-XXX step5C: get_cohort_funnel — 初回面談した月ごとに同じ求職者群を追う（提案→応募→書類通過→企業面接→内定→承諾→入社）。
//
// 個人の行は DB から読むが、返すのは月 × CA の人数・日数の分布だけ。
import { prisma } from "@/lib/prisma";
import { proposalEventsSql, ENTRY_FLAGS_COUNTED_SQL } from "@/lib/performance/weeklyMatrix";
import { entryStageCaseSql } from "@/lib/aiRead/caKpi";
import {
  buildEnvelope, resolveCas, resolveMonthRange, firstInterviewCteSql, jstMonthExpr, sqlStr, daysBetween, jstMonthOf,
  distribution, ratio, shouldSuppress, tenureMonthsFor, checkResponseSize, COMMON_DEFINITIONS, RELIABLE_FROM_MONTH, ALL_KEY, type RosterCa,
} from "./common";

export const COHORT_STAGES = ["proposal", "entry", "documentPass", "companyInterview", "offer", "acceptance", "join"] as const;
export type CohortStage = (typeof COHORT_STAGES)[number];

interface CohortRow {
  candidate_id: string;
  employee_id: string | null;
  first_at: Date;
  support_status: string;
  proposal_at: Date | null;
  entry_at: Date | null;
  document_pass_at: Date | null;
  company_interview_at: Date | null;
  offer_at: Date | null;
  acceptance_at: Date | null;
  join_at: Date | null;
  in_selection: boolean;
}

/** 初回面談月が [from, to] の求職者 1 人 1 行（内部用・外に出さない）。 */
export async function loadCohortRows(from: string, to: string): Promise<CohortRow[]> {
  const sql = `
    WITH ${firstInterviewCteSql()},
    coh AS (
      SELECT f.candidate_id, f.first_at, c.employee_id, c.support_status
      FROM first_iv f JOIN candidates c ON c.id = f.candidate_id
      WHERE ${jstMonthExpr("f.first_at")} BETWEEN ${sqlStr(from)} AND ${sqlStr(to)}
    ),
    prop AS (
      SELECT e.candidate_id, MIN(e.pdate) AS d
      FROM (${proposalEventsSql("TRUE")}) e JOIN coh ON coh.candidate_id = e.candidate_id
      WHERE e.pdate >= coh.first_at - interval '1 day'
      GROUP BY e.candidate_id
    ),
    ent AS (
      SELECT je.candidate_id,
        MIN(je.entry_date) FILTER (WHERE je.entry_flag IN (${ENTRY_FLAGS_COUNTED_SQL}) AND je.entry_date >= coh.first_at - interval '1 day') AS entry_at,
        MIN(je.document_pass_date) FILTER (WHERE je.document_pass_date >= coh.first_at - interval '1 day') AS document_pass_at,
        MIN(LEAST(je.first_interview_date, je.second_interview_date, je.final_interview_date))
          FILTER (WHERE LEAST(je.first_interview_date, je.second_interview_date, je.final_interview_date) >= coh.first_at - interval '1 day') AS company_interview_at,
        MIN(je.offer_date) FILTER (WHERE je.offer_date >= coh.first_at - interval '1 day') AS offer_at,
        MIN(je.acceptance_date) FILTER (WHERE je.acceptance_date >= coh.first_at - interval '1 day') AS acceptance_at,
        MIN(je.join_date) FILTER (WHERE je.join_date >= coh.first_at - interval '1 day' AND (je.entry_flag = '入社済' OR je.person_flag = '入社済')) AS join_at,
        BOOL_OR(je.is_active AND (${entryStageCaseSql()}) IN ('entered','documentScreening','firstInterview','secondInterview','finalInterview','interviewOther','offered')) AS in_selection
      FROM job_entries je JOIN coh ON coh.candidate_id = je.candidate_id
      WHERE je.archived_at IS NULL
      GROUP BY je.candidate_id
    )
    SELECT coh.candidate_id, coh.employee_id, coh.first_at, coh.support_status,
      prop.d AS proposal_at, ent.entry_at, ent.document_pass_at, ent.company_interview_at, ent.offer_at, ent.acceptance_at, ent.join_at,
      COALESCE(ent.in_selection, FALSE) AS in_selection
    FROM coh LEFT JOIN prop ON prop.candidate_id = coh.candidate_id LEFT JOIN ent ON ent.candidate_id = coh.candidate_id;`;
  return prisma.$queryRawUnsafe<CohortRow[]>(sql);
}

function stageDate(r: CohortRow, s: CohortStage): Date | null {
  switch (s) {
    case "proposal": return r.proposal_at;
    case "entry": return r.entry_at;
    case "documentPass": return r.document_pass_at;
    case "companyInterview": return r.company_interview_at;
    case "offer": return r.offer_at;
    case "acceptance": return r.acceptance_at;
    case "join": return r.join_at;
  }
}

export interface CohortGroupSummary {
  people: number | null;
  suppressed?: true;
  reached?: Record<CohortStage, number>;
  rates?: Record<CohortStage, number | null>;
  daysFromFirstInterview?: Record<CohortStage, unknown>;
  outcome?: { accepted: number; observing: number; ended: number };
}

/** 1 グループ（月 × CA など）の集計。人数が閾値未満なら伏せる。 */
export function summarizeCohort(rows: CohortRow[]): CohortGroupSummary {
  const people = rows.length;
  if (people === 0) return { people: 0 };
  if (shouldSuppress(people)) return { people: null, suppressed: true };
  const reached = {} as Record<CohortStage, number>;
  const rates = {} as Record<CohortStage, number | null>;
  const days = {} as Record<CohortStage, unknown>;
  for (const s of COHORT_STAGES) {
    const hit = rows.filter((r) => stageDate(r, s) != null);
    reached[s] = hit.length;
    rates[s] = ratio(hit.length, people);
    days[s] = distribution(hit.map((r) => daysBetween(r.first_at, stageDate(r, s)) ?? NaN));
  }
  let accepted = 0;
  let observing = 0;
  let ended = 0;
  for (const r of rows) {
    if (r.acceptance_at) accepted++;
    else if (r.in_selection || r.support_status === "ACTIVE" || r.support_status === "WAITING") observing++;
    else ended++;
  }
  return { people, reached, rates, daysFromFirstInterview: days, outcome: { accepted, observing, ended } };
}

export async function buildCohortFunnel(input: { cohortFrom?: string; cohortTo?: string; caId?: string; byCa?: boolean }): Promise<Record<string, unknown>> {
  const { from, to, months } = resolveMonthRange(input.cohortFrom, input.cohortTo, { from: RELIABLE_FROM_MONTH });
  const { roster, targets, single } = await resolveCas(input.caId);
  const byCa = input.byCa ?? true;
  const rows = await loadCohortRows(from, to);
  const byMonth = new Map<string, CohortRow[]>();
  for (const r of rows) {
    const m = jstMonthOf(r.first_at)!;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(r);
  }
  const monthRows: Record<string, unknown>[] = [];
  const groupRow = (ca: RosterCa | null, month: string | null, rs: CohortRow[]) => ({
    ca: ca ? ca.employeeNumber : ALL_KEY,
    month,
    reference: month ? month < RELIABLE_FROM_MONTH : false,
    ...summarizeCohort(rs),
  });
  for (const m of months) {
    const rs = byMonth.get(m) ?? [];
    if (!single) monthRows.push(groupRow(null, m, rs));
    if (byCa || single) {
      for (const ca of targets) {
        if (!tenureMonthsFor(ca, [m]).length) continue;
        monthRows.push(groupRow(ca, m, rs.filter((r) => r.employee_id === ca.id)));
      }
    }
  }
  // 期間全体（人は初回面談が 1 回なので月の合計と同じだが、CA の在籍月で絞る）
  const totalRows: Record<string, unknown>[] = [];
  if (!single) totalRows.push(groupRow(null, null, rows));
  for (const ca of targets) {
    const okMonths = new Set(tenureMonthsFor(ca, months));
    totalRows.push(groupRow(ca, null, rows.filter((r) => r.employee_id === ca.id && okMonths.has(jstMonthOf(r.first_at)!))));
  }

  const env = await buildEnvelope({
    tool: "get_cohort_funnel",
    period: { cohortFrom: from, cohortTo: to, months: months.length, basis: "初回面談の JST 月" },
    cas: targets,
    single,
    roster,
    exclusions: [
      "辞退系・日程再調整の面談は初回面談にしない",
      "初回面談日の前日より前の提案・応募・選考は数えない（別の転職活動の分）",
      "アーカイブ済みのエントリーは数えない",
      "自動引き当て・本人追加のブックマークは提案に数えない（既存の proposal と同じ）",
    ],
    counts: { cohortPeople: rows.length, months: months.length },
    warnings: [
      "承諾まで 1〜2 か月以上かかるため、直近 2 か月のコホートは『観測中』が多く承諾率は確定していない。observationEnd と outcome.observing を必ず添える",
    ],
    definitions: {
      cohort: "初回面談（定義は firstInterview）が JST のその月にある求職者の集合。1 人は 1 つの月にだけ入る",
      proposal: "初回面談の前日以降で最初の求人提案（既存 get_ca_kpi の proposal と同じ: job_intro_date ∪ ブックマークの COALESCE(出力日, 紹介日)。自動引き当て・本人追加を除く）",
      entry: "初回面談の前日以降で最初のエントリー（entry_flag が 応募/エントリー/書類選考/面接/内定/入社済）",
      documentPass: "最初の書類通過日（document_pass_date）",
      companyInterview: "一次・二次・最終のいずれか最初の企業面接日",
      offer: "最初の内定日（offer_date）",
      acceptance: "最初の承諾日（acceptance_date）。承諾後に辞退した人も『承諾あり』に数える（承諾後辞退は get_accept_revenue で分ける）",
      join: "入社日（join_date）があり entry_flag/person_flag が入社済の最初の日",
      reached: "その段階へ 1 回でも進んだ人数（人数ベース。件数ではない）。rates は reached ÷ people",
      daysFromFirstInterview: "初回面談日からその段階の最初の日までの暦日数の分布（進んだ人だけ）",
      outcome: "accepted=承諾あり、observing=承諾なしで『支援中/待機』または選考中の案件あり、ended=それ以外（支援終了・アーカイブ・案件がすべて終了）",
      firstInterview: COMMON_DEFINITIONS.firstInterview,
      attribution: COMMON_DEFINITIONS.attribution,
      tenure: COMMON_DEFINITIONS.tenure,
      suppression: COMMON_DEFINITIONS.suppression,
      reference: COMMON_DEFINITIONS.reference,
    },
  });
  const body = { ...env, stages: COHORT_STAGES, byMonth: monthRows, total: totalRows };
  const tooBig = checkResponseSize(body);
  if (tooBig) throw new Error(tooBig);
  return body;
}
