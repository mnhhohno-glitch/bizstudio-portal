// T-XXX step5C: get_segment_breakdown — 希望職種・経験職種・年収帯・転職時期・最終学歴区分などの選択式項目で分けた
// 初回面談数・応募・承諾・日数。少人数は伏せる。区分の元は初回面談の面談詳細（interview_details）。
import { prisma } from "@/lib/prisma";
import { loadCohortRows } from "./cohort";
import {
  buildEnvelope, resolveCas, resolveMonthRange, firstInterviewCteSql, jstMonthExpr, sqlStr, daysBetween, distribution, ratio, shouldSuppress,
  tenureMonthsFor, jstMonthOf, checkResponseSize, COMMON_DEFINITIONS, RELIABLE_FROM_MONTH, ALL_KEY, type RosterCa,
} from "./common";

export const SEGMENTS = [
  "desiredJobType",
  "experienceJobType",
  "currentSalaryBand",
  "desiredSalaryBand",
  "jobChangeTimeline",
  "educationLevel",
  "desiredPrefecture",
  "desiredEmploymentType",
  "activityPeriod",
  "agentUsage",
] as const;
export type Segment = (typeof SEGMENTS)[number];

interface DetailRow {
  candidate_id: string;
  desired_job_type_1: string | null;
  job_type_flag: string | null;
  current_salary: number | null;
  desired_salary_min: number | null;
  job_change_timeline: string | null;
  education_flag: string | null;
  desired_prefecture: string | null;
  desired_employment_type: string | null;
  activity_period: string | null;
  agent_usage_flag: string | null;
}

const UNKNOWN = "未記載";

/** 年収帯（万円）。0 は不明扱い（0 と未記載の区別が付かないため）。 */
export function salaryBand(v: number | null): string {
  if (v == null || v <= 0) return UNKNOWN;
  if (v < 300) return "〜299";
  if (v < 400) return "300〜399";
  if (v < 500) return "400〜499";
  if (v < 600) return "500〜599";
  return "600〜";
}

/** 学歴区分の寄せ（表記ゆれを粗い区分に）。 */
export function educationLevel(v: string | null): string {
  if (!v) return UNKNOWN;
  const s = v.replace(/\s/g, "");
  if (/大学院|修士|博士/.test(s)) return "大学院卒";
  if (/大学|大卒/.test(s)) return "大学卒";
  if (/短大|専門|高専/.test(s)) return "短大・専門卒";
  if (/高校|高卒/.test(s)) return "高校卒";
  if (/中学|中卒/.test(s)) return "中学卒";
  return "その他";
}

export function segmentValue(seg: Segment, d: DetailRow | undefined): string {
  if (!d) return UNKNOWN;
  const s = (v: string | null) => (v && v.trim() ? v.trim() : UNKNOWN);
  switch (seg) {
    case "desiredJobType": return s(d.desired_job_type_1);
    case "experienceJobType": return s(d.job_type_flag);
    case "currentSalaryBand": return salaryBand(d.current_salary);
    case "desiredSalaryBand": return salaryBand(d.desired_salary_min);
    case "jobChangeTimeline": return s(d.job_change_timeline);
    case "educationLevel": return educationLevel(d.education_flag);
    case "desiredPrefecture": return s(d.desired_prefecture);
    case "desiredEmploymentType": return s(d.desired_employment_type);
    case "activityPeriod": return s(d.activity_period);
    case "agentUsage": return s(d.agent_usage_flag);
  }
}

export async function buildSegmentBreakdown(input: { segment: Segment; from?: string; to?: string; caId?: string; byCa?: boolean }): Promise<Record<string, unknown>> {
  const { from, to, months } = resolveMonthRange(input.from, input.to, { from: RELIABLE_FROM_MONTH });
  const { roster, targets, single } = await resolveCas(input.caId);
  const byCa = input.byCa ?? false;
  const [cohort, details] = await Promise.all([
    loadCohortRows(from, to),
    prisma.$queryRawUnsafe<DetailRow[]>(`
      WITH ${firstInterviewCteSql()}
      SELECT f.candidate_id, d.desired_job_type_1, d.job_type_flag, d.current_salary, d.desired_salary_min, d.job_change_timeline,
        d.education_flag, d.desired_prefecture, d.desired_employment_type, d.activity_period, d.agent_usage_flag
      FROM first_iv f JOIN interview_details d ON d.interview_record_id = f.interview_id
      WHERE ${jstMonthExpr("f.first_at")} BETWEEN ${sqlStr(from)} AND ${sqlStr(to)};`),
  ]);
  const detailById = new Map(details.map((d) => [d.candidate_id, d]));
  const summarize = (rows: typeof cohort) => {
    const people = rows.length;
    if (people === 0) return { people: 0 };
    if (shouldSuppress(people)) return { people: null, suppressed: true as const };
    const c = (f: (r: (typeof rows)[number]) => unknown) => rows.filter((r) => f(r) != null).length;
    const proposed = c((r) => r.proposal_at);
    const entered = c((r) => r.entry_at);
    const companyInterview = c((r) => r.company_interview_at);
    const offered = c((r) => r.offer_at);
    const accepted = c((r) => r.acceptance_at);
    return {
      people,
      proposed,
      entered,
      companyInterview,
      offered,
      accepted,
      rates: { entered: ratio(entered, people), companyInterview: ratio(companyInterview, people), accepted: ratio(accepted, people) },
      daysToEntry: distribution(rows.filter((r) => r.entry_at).map((r) => daysBetween(r.first_at, r.entry_at) ?? NaN)),
      daysToAcceptance: distribution(rows.filter((r) => r.acceptance_at).map((r) => daysBetween(r.first_at, r.acceptance_at) ?? NaN)),
      observing: rows.filter((r) => !r.acceptance_at && (r.in_selection || r.support_status === "ACTIVE" || r.support_status === "WAITING")).length,
    };
  };
  const scopeRows = (ca: RosterCa | null) => {
    const okMonths = ca ? new Set(tenureMonthsFor(ca, months)) : null;
    const rows = ca ? cohort.filter((r) => r.employee_id === ca.id && okMonths!.has(jstMonthOf(r.first_at)!)) : cohort;
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const v = segmentValue(input.segment, detailById.get(r.candidate_id));
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v)!.push(r);
    }
    const segs = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([value, rs]) => ({ value, ...summarize(rs) }));
    return { ca: ca ? ca.employeeNumber : ALL_KEY, people: rows.length, withDetail: rows.filter((r) => detailById.has(r.candidate_id)).length, segments: segs };
  };
  const scopes: Record<string, unknown>[] = [];
  if (!single) scopes.push(scopeRows(null));
  if (byCa || single) for (const ca of targets) scopes.push(scopeRows(ca));
  const env = await buildEnvelope({
    tool: "get_segment_breakdown",
    period: { from, to, months: months.length, basis: "初回面談の JST 月" },
    cas: targets,
    single,
    roster,
    exclusions: ["辞退系・日程再調整の面談は初回面談にしない", "初回面談の面談詳細が無い人は『未記載』に入る"],
    counts: { cohortPeople: cohort.length, withDetail: details.length, missingRate: ratio(cohort.length - details.length, cohort.length) },
    warnings: [
      "区分の値は面談詳細の入力そのまま（表記ゆれがある）。educationLevel と年収帯だけ寄せている",
      "少人数の区分は伏せられる。相関を因果と読まないこと（区分と担当CA・時期が絡む）",
    ],
    definitions: {
      segment: "初回面談の面談詳細（interview_details）の値で分ける。desiredJobType=希望職種1、experienceJobType=経験職種（job_type_flag）、currentSalaryBand=現年収帯（万円）、desiredSalaryBand=希望年収下限の帯（万円）、jobChangeTimeline=転職時期、educationLevel=最終学歴区分（寄せ）、desiredPrefecture=希望勤務地（都道府県）、desiredEmploymentType=希望雇用形態、activityPeriod=活動期間、agentUsage=他社エージェント利用",
      salaryBand: "万円。0 または未記載は『未記載』（0 と未記載の区別が付かないため）",
      funnel: "get_cohort_funnel と同じ定義（初回面談の前日以降の最初の提案・エントリー・企業面接・内定・承諾）。人数ベース",
      observing: "承諾なしで活動中（支援中/待機）または選考中の人数",
      firstInterview: COMMON_DEFINITIONS.firstInterview,
      attribution: COMMON_DEFINITIONS.attribution,
      suppression: COMMON_DEFINITIONS.suppression,
    },
  });
  const body = { ...env, segment: input.segment, availableSegments: SEGMENTS, scopes };
  const tooBig = checkResponseSize(body);
  if (tooBig) throw new Error(tooBig);
  return body;
}
