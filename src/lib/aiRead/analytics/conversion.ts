// T-XXX step5C: get_selection_conversion — 応募した月ごとに同じ案件群を追う（段階ごとの通過・辞退・見送り・選考中・結果不明と日数）。
import { prisma } from "@/lib/prisma";
import { ENTRY_FLAGS_COUNTED_SQL } from "@/lib/performance/weeklyMatrix";
import { entryStageCaseSql } from "@/lib/aiRead/caKpi";
import {
  buildEnvelope, resolveCas, resolveMonthRange, jstMonthExpr, sqlStr, daysBetween, jstMonthOf, distribution, ratio, shouldSuppress,
  tenureMonthsFor, checkResponseSize, COMMON_DEFINITIONS, RELIABLE_FROM_MONTH, ALL_KEY, type RosterCa,
} from "./common";

export const SELECTION_STAGES_C = ["documentSubmit", "documentPass", "firstInterview", "secondInterview", "finalInterview", "companyInterview", "offer", "acceptance", "join"] as const;
export type SelStage = (typeof SELECTION_STAGES_C)[number];
export const OUTCOMES = ["accepted", "acceptedThenDeclined", "declined", "rejected", "closed", "inProgress", "unknown"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface EntryRow {
  id: string;
  candidate_id: string;
  employee_id: string | null;
  entry_at: Date;
  document_submit_at: Date | null;
  document_pass_at: Date | null;
  first_interview_at: Date | null;
  second_interview_at: Date | null;
  final_interview_at: Date | null;
  offer_at: Date | null;
  acceptance_at: Date | null;
  join_at: Date | null;
  stage: string | null;
  is_active: boolean;
  entry_flag_detail: string | null;
  revenue: number | null;
  job_db_cost: number | null;
  cost: number | null;
  fee_type: string | null;
}

/** エントリー月が [from, to] の案件 1 件 1 行（内部用）。 */
export async function loadEntryRows(from: string, to: string, opts: { basis: "entry" | "acceptance" } = { basis: "entry" }): Promise<EntryRow[]> {
  const col = opts.basis === "entry" ? "je.entry_date" : "je.acceptance_date";
  const flagPred = opts.basis === "entry" ? `AND je.entry_flag IN (${ENTRY_FLAGS_COUNTED_SQL})` : "AND je.acceptance_date IS NOT NULL";
  return prisma.$queryRawUnsafe<EntryRow[]>(`
    SELECT je.id, je.candidate_id, c.employee_id, je.entry_date AS entry_at,
      je.document_submit_date AS document_submit_at, je.document_pass_date AS document_pass_at,
      je.first_interview_date AS first_interview_at, je.second_interview_date AS second_interview_at, je.final_interview_date AS final_interview_at,
      je.offer_date AS offer_at, je.acceptance_date AS acceptance_at, je.join_date AS join_at,
      ${entryStageCaseSql()} AS stage, je.is_active, je.entry_flag_detail, je.revenue, je.job_db_cost, je.cost, je.fee_type::text AS fee_type
    FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
    WHERE je.archived_at IS NULL AND ${col} IS NOT NULL ${flagPred}
      AND ${jstMonthExpr(col)} BETWEEN ${sqlStr(from)} AND ${sqlStr(to)};`);
}

export function stageDateOf(r: EntryRow, s: SelStage): Date | null {
  switch (s) {
    case "documentSubmit": return r.document_submit_at;
    case "documentPass": return r.document_pass_at;
    case "firstInterview": return r.first_interview_at;
    case "secondInterview": return r.second_interview_at;
    case "finalInterview": return r.final_interview_at;
    case "companyInterview": {
      const ds = [r.first_interview_at, r.second_interview_at, r.final_interview_at].filter((d): d is Date => d != null);
      return ds.length ? new Date(Math.min(...ds.map((d) => d.getTime()))) : null;
    }
    case "offer": return r.offer_at;
    case "acceptance": return r.acceptance_at;
    case "join": return r.join_at;
  }
}

const IN_PROGRESS_STAGES = new Set(["entered", "documentScreening", "firstInterview", "secondInterview", "finalInterview", "interviewOther", "offered"]);

/** 今の結果区分（取得時点）。 */
export function outcomeOf(r: EntryRow): Outcome {
  if (r.acceptance_at) return r.stage === "declined" ? "acceptedThenDeclined" : "accepted";
  if (r.stage === "declined") return "declined";
  if (r.stage === "rejected") return "rejected";
  if (r.stage === "closed") return "closed";
  if (r.stage === "joined") return "accepted"; // 承諾日が無いまま入社済になった行は承諾扱い
  if (r.stage && IN_PROGRESS_STAGES.has(r.stage) && r.is_active) return "inProgress";
  return "unknown";
}

export interface ConversionGroupSummary {
  records: number;
  people: number | null;
  suppressed?: true;
  reached?: Record<SelStage, { records: number; people: number; rate: number | null }>;
  daysFromEntry?: Record<SelStage, unknown>;
  outcome?: Record<Outcome, number>;
}

export function summarizeConversion(rows: EntryRow[]): ConversionGroupSummary {
  const records = rows.length;
  const people = new Set(rows.map((r) => r.candidate_id)).size;
  if (records === 0) return { records: 0, people: 0 };
  if (shouldSuppress(people)) return { records, people: null, suppressed: true };
  const reached = {} as ConversionGroupSummary["reached"] & object;
  const days = {} as Record<SelStage, unknown>;
  for (const s of SELECTION_STAGES_C) {
    const hit = rows.filter((r) => stageDateOf(r, s) != null);
    reached[s] = { records: hit.length, people: new Set(hit.map((r) => r.candidate_id)).size, rate: ratio(hit.length, records) };
    days[s] = distribution(hit.map((r) => daysBetween(r.entry_at, stageDateOf(r, s)) ?? NaN));
  }
  const outcome = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  for (const r of rows) outcome[outcomeOf(r)]++;
  return { records, people, reached, daysFromEntry: days, outcome };
}

export async function buildSelectionConversion(input: { from?: string; to?: string; caId?: string; byCa?: boolean }): Promise<Record<string, unknown>> {
  const { from, to, months } = resolveMonthRange(input.from, input.to, { from: RELIABLE_FROM_MONTH });
  const { roster, targets, single } = await resolveCas(input.caId);
  const byCa = input.byCa ?? true;
  const rows = await loadEntryRows(from, to);
  const byMonth = new Map<string, EntryRow[]>();
  for (const r of rows) {
    const m = jstMonthOf(r.entry_at)!;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(r);
  }
  const groupRow = (ca: RosterCa | null, month: string | null, rs: EntryRow[]) => ({
    ca: ca ? ca.employeeNumber : ALL_KEY,
    month,
    reference: month ? month < RELIABLE_FROM_MONTH : false,
    ...summarizeConversion(rs),
  });
  const monthRows: Record<string, unknown>[] = [];
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
  const totalRows: Record<string, unknown>[] = [];
  if (!single) totalRows.push(groupRow(null, null, rows));
  for (const ca of targets) {
    const okMonths = new Set(tenureMonthsFor(ca, months));
    totalRows.push(groupRow(ca, null, rows.filter((r) => r.employee_id === ca.id && okMonths.has(jstMonthOf(r.entry_at)!))));
  }
  const env = await buildEnvelope({
    tool: "get_selection_conversion",
    period: { from, to, months: months.length, basis: "エントリー日（entry_date）の JST 月" },
    cas: targets,
    single,
    roster,
    exclusions: ["アーカイブ済みのエントリー", "entry_flag が 応募/エントリー/書類選考/面接/内定/入社済 以外（求人紹介のみの行）"],
    counts: { records: rows.length, people: new Set(rows.map((r) => r.candidate_id)).size, months: months.length },
    warnings: [
      "同じ月の通過数÷応募数を通過率にしないこと。ここは『その月に応募した案件群』を後まで追った到達数なので、直近の月は inProgress が多く率は未確定",
      "書類提出日（documentSubmit）は 2026-06 以降に入力が始まった。二次面接は入力が少ない",
    ],
    definitions: {
      cohort: "entry_date がその JST 月にある案件（1 案件 1 行。同じ人の複数応募は別の行）",
      reached: "その段階の日付がある件数（records）・人数（people）。rate は records ÷ 月の案件数。到達ベースであり選考中の案件を不合格に数えない",
      daysFromEntry: "エントリー日からその段階の日付までの暦日数の分布",
      outcome: "取得時点の結果: accepted=承諾（承諾日あり、または入社済）、acceptedThenDeclined=承諾後に辞退（承諾日あり＋辞退）、declined=本人辞退、rejected=選考落ち・見送り、closed=クローズ・求人クローズ、inProgress=有効で段階が エントリー〜内定（承諾前）、unknown=上記以外（未応募で無効化など）",
      companyInterview: "一次・二次・最終のいずれか最初の面接日",
      attribution: COMMON_DEFINITIONS.attribution,
      tenure: COMMON_DEFINITIONS.tenure,
      suppression: COMMON_DEFINITIONS.suppression,
      reference: COMMON_DEFINITIONS.reference,
    },
  });
  const body = { ...env, stages: SELECTION_STAGES_C, outcomes: OUTCOMES, byMonth: monthRows, total: totalRows };
  const tooBig = checkResponseSize(body);
  if (tooBig) throw new Error(tooBig);
  return body;
}
