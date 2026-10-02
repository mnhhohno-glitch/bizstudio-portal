// T-XXX step5C: 分析ツール（MCP）共通の定義・SQL 部品・集計ヘルパ。読み取りのみ。
//
// 共通の定義（step4 の結論）:
//   - 在籍CA: employees.job_category='CA'。集計対象の月は hire_date の月〜resign_date の月（入社月・退職月は 1 か月と数える）。
//     入社日が未登録の CA は集計に含めるが warnings に出す（推定で埋めない）。
//   - 初回面談: その求職者の面談記録のうち、result_flag が辞退系（連絡なし辞退・連絡あり辞退・辞退）でも日程再調整でもなく、
//     面談日が過去の、最も早い 1 件（interview_count は使わない）。
//   - 担当軸: 求職者の『今の』担当CA（candidates.employee_id）。既存ツールと同じ。
//   - 少人数の伏せ: 人数（分母）が 1〜4 のグループは内訳を null にして suppressed=true。日数の分布は標本 5 未満なら null。
//   - 2026-04 以前は FileMaker 移行データが混ざるため参考値（reference=true）。既定の対象期間は 2026-05-01 以降。
//   - 日付列は timestamp（UTC 保存）なので JST への変換は jstExpr（AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo'）で行う。
//   - (step6) 稼働しない期間（employee_inactive_periods）は退職後・入社前と同じ「在籍していない日」。CA の月の行に稼働日数・稼働人月
//     （availability）を付け、CA 平均・1人あたりはこれで割る。その期間に記録された活動は捨てずに CA の行に数え、warnings に件数を出す。
//   - (step6) 退職後に決まった成果（退職日より後の日付のエントリー・承諾など）は ALL（会社全体）に含め、CA の行からは外して
//     postExit（元担当 CA ごと）に分けて返す。退職後の月は稼働人月 0 なので活動の分母にも入らない。

import { prisma } from "@/lib/prisma";
import { DECLINED_SQL } from "@/lib/performance/weeklyMatrix";
import { todayJstDateString } from "@/lib/dailyReport/jstDate";
import { jstIso, jstYmd } from "@/lib/aiRead/caKpiResponse";
import { queryCaKpiMeta } from "@/lib/aiRead/caKpi";
import { dbDateToYmd, monthAvailability, nextYmd, type InactivePeriodYmd, type MonthAvailability } from "@/lib/employee-inactive-periods";

export const DEFINITION_VERSION = "2026-10-02.step6";
/** 少人数の伏せの閾値（これ未満の人数のグループは内訳を伏せる）。 */
export const SUPPRESS_THRESHOLD = 5;
/** 信頼できる期間の開始（これより前は参考値）。 */
export const RELIABLE_FROM_MONTH = "2026-05";
/** 応答サイズの上限（既存 ca-kpi の rows 上限と同じ目安）。 */
export const MAX_RESPONSE_BYTES = 85_000;
/** 1 回の呼び出しで扱える最大月数。 */
export const MAX_MONTHS = 18;

export const ALL_KEY = "ALL";

// ---- SQL 部品 ---------------------------------------------------------------

export const NOW_UTC = "(now() AT TIME ZONE 'UTC')";
export const jstExpr = (col: string) => `(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')`;
export const jstMonthExpr = (col: string) => `to_char(${jstExpr(col)}, 'YYYY-MM')`;
export const jstDateExpr = (col: string) => `(${jstExpr(col)})::date`;
/** 実施扱いの面談（辞退系・日程再調整以外）。alias は interview_records の別名。 */
export const heldInterviewPred = (alias: string) =>
  `(${alias}.result_flag IS NULL OR ${alias}.result_flag NOT IN (${DECLINED_SQL}, '日程再調整'))`;

/** 初回面談の CTE 本文（first_iv(candidate_id, first_at, interview_id)）。 */
export function firstInterviewCteSql(): string {
  return `first_iv AS (
      SELECT DISTINCT ON (ir.candidate_id) ir.candidate_id, ir.interview_date AS first_at, ir.id AS interview_id
      FROM interview_records ir
      WHERE ${heldInterviewPred("ir")} AND ir.interview_date <= ${NOW_UTC}
      ORDER BY ir.candidate_id, ir.interview_date ASC, ir.created_at ASC
    )`;
}

export const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function assertMonth(s: string, label: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw new Error(`${label} は YYYY-MM 形式で指定してください`);
}

/** 月の範囲（両端を含む）を 'YYYY-MM' の配列にする。 */
export function monthsBetween(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map((x) => parseInt(x, 10));
  const [ty, tm] = to.split("-").map((x) => parseInt(x, 10));
  const out: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 120) break;
  }
  return out;
}

export function currentMonthJst(): string {
  return todayJstDateString().slice(0, 7);
}

/** 月範囲の入力を検証して決める（既定: 2026-05〜今月）。 */
export function resolveMonthRange(from: string | undefined, to: string | undefined, defaults: { from: string }): { from: string; to: string; months: string[] } {
  const f = from ?? defaults.from;
  const t = to ?? currentMonthJst();
  assertMonth(f, "from");
  assertMonth(t, "to");
  if (f > t) throw new Error("from は to 以前の月を指定してください");
  const months = monthsBetween(f, t);
  if (months.length > MAX_MONTHS) throw new Error(`期間が長すぎます（${months.length} か月。上限 ${MAX_MONTHS} か月）。期間を分けて呼んでください`);
  return { from: f, to: t, months };
}

// ---- 在籍CA（roster） ---------------------------------------------------------

export interface RosterCa {
  id: string;
  employeeNumber: string;
  name: string;
  status: string;
  hireDate: Date | null;
  resignDate: Date | null;
  /** 在籍月の開始（YYYY-MM）。未登録なら null */
  tenureFromMonth: string | null;
  /** 在籍月の終了（YYYY-MM）。在籍中・未登録なら null */
  tenureToMonth: string | null;
  /** (step6) 稼働しない期間（日付だけ。理由は持たない） */
  inactivePeriods: InactivePeriodYmd[];
}

const EMPLOYEE_ROSTER_SELECT = {
  id: true,
  employeeNumber: true,
  name: true,
  status: true,
  hireDate: true,
  resignDate: true,
  inactivePeriods: { select: { startDate: true, endDate: true }, orderBy: { startDate: "asc" } },
} as const;

type EmployeeRosterRow = {
  id: string;
  employeeNumber: string;
  name: string;
  status: string;
  hireDate: Date | null;
  resignDate: Date | null;
  inactivePeriods: { startDate: Date; endDate: Date | null }[];
};

function toRosterCa(r: EmployeeRosterRow): RosterCa {
  return {
    id: r.id,
    employeeNumber: r.employeeNumber,
    name: r.name,
    status: r.status,
    hireDate: r.hireDate,
    resignDate: r.resignDate,
    tenureFromMonth: r.hireDate ? jstYmd(r.hireDate)!.slice(0, 7) : null,
    tenureToMonth: r.resignDate ? jstYmd(r.resignDate)!.slice(0, 7) : null,
    inactivePeriods: r.inactivePeriods.map((p) => ({ startDate: dbDateToYmd(p.startDate)!, endDate: dbDateToYmd(p.endDate) })),
  };
}

export async function loadRoster(): Promise<RosterCa[]> {
  const rows = await prisma.employee.findMany({
    where: { jobCategory: "CA" },
    select: EMPLOYEE_ROSTER_SELECT,
    orderBy: { employeeNumber: "asc" },
  });
  return rows.map(toRosterCa);
}

/** その月に在籍しているか（入社日が未登録なら true＝含める。退職日が未登録なら status=active で判定）。 */
export function inTenureMonth(ca: RosterCa, month: string): boolean {
  if (ca.tenureFromMonth && month < ca.tenureFromMonth) return false;
  if (ca.tenureToMonth && month > ca.tenureToMonth) return false;
  return true;
}

/** 既定の集計対象（在籍中の CA）。退職日が入っていて過去なら外す。 */
export function isDefaultCa(ca: RosterCa, today = todayJstDateString()): boolean {
  if (ca.status !== "active") return false;
  if (ca.tenureToMonth && ca.tenureToMonth < today.slice(0, 7)) return false;
  return true;
}

export function rosterWarnings(cas: RosterCa[]): string[] {
  const w: string[] = [];
  const noHire = cas.filter((c) => isDefaultCa(c) && !c.hireDate);
  if (noHire.length) {
    w.push(
      `入社日未登録: ${noHire.map((c) => `${c.employeeNumber}（${c.name}）`).join("・")}。在籍期間で絞れないため全期間を在籍として扱っている（社員詳細で入社日を入力すると自動で反映）`,
    );
  }
  return w;
}

/**
 * caId（社員番号 or Employee.id）から対象 CA を決める。省略時は既定の在籍 CA 全員。
 */
export async function resolveCas(caId: string | undefined): Promise<{ roster: RosterCa[]; targets: RosterCa[]; single: boolean }> {
  const roster = await loadRoster();
  if (caId) {
    const ca = roster.find((c) => c.employeeNumber === caId || c.id === caId);
    if (!ca) {
      // CA 以外の社員が指定された可能性（担当として求職者を持つ場合がある）
      const emp = await prisma.employee.findFirst({
        where: { OR: [{ employeeNumber: caId }, { id: caId }] },
        select: EMPLOYEE_ROSTER_SELECT,
      });
      if (!emp) throw new Error(`caId に該当する社員が見つかりません: ${caId}。get_ca_roster / list_cas で employeeNumber を確認してください`);
      return { roster, targets: [toRosterCa(emp)], single: true };
    }
    return { roster, targets: [ca], single: true };
  }
  return { roster, targets: roster.filter((c) => isDefaultCa(c)), single: false };
}

export const caLabel = (ca: RosterCa) => ({ employeeNumber: ca.employeeNumber, name: ca.name });

// ---- (step6) 稼働日数・退職後の成果 ---------------------------------------------

/** 退職日（JST の暦日）。未登録なら null。 */
export const resignYmdOf = (ca: RosterCa): string | null => jstYmd(ca.resignDate);

/** その月の稼働日数・稼働人月（入社日〜退職日 − 稼働しない期間。暦日按分）。 */
export function availabilityOf(ca: RosterCa, month: string): MonthAvailability {
  return monthAvailability({ hireYmd: jstYmd(ca.hireDate), resignYmd: resignYmdOf(ca), periods: ca.inactivePeriods }, month);
}

/** CA の月の行に付ける稼働の情報（返す形）。 */
export function availabilityBlock(ca: RosterCa, month: string) {
  const a = availabilityOf(ca, month);
  return { calendarDays: a.calendarDays, activeDays: a.activeDays, inactiveDays: a.inactiveDays, fte: a.fte };
}

/** 期間の稼働人月の合計（CA の期間合計の行に付ける）。 */
export function activeMonthsOf(ca: RosterCa, months: string[]): number {
  return Math.round(months.reduce((s, m) => s + availabilityOf(ca, m).fte, 0) * 1000) / 1000;
}

/** その日付が退職日より後か（退職日未登録・日付なしは false）。 */
export function isAfterExit(ca: RosterCa, d: Date | null | undefined): boolean {
  const r = resignYmdOf(ca);
  if (!r || !d) return false;
  return jstYmd(d)! > r;
}

/** CA の行に入れるか: 在籍月であり、退職日より後でない（退職後の成果は postExit に分ける）。 */
export function inCaScope(ca: RosterCa, d: Date | null | undefined): boolean {
  if (!d) return false;
  return inTenureMonth(ca, jstMonthOf(d)!) && !isAfterExit(ca, d);
}

/** 退職日が今日より前の CA（退職後の成果を分けて出す対象）。 */
export function exitedCas(roster: RosterCa[], today = todayJstDateString()): RosterCa[] {
  return roster.filter((c) => {
    const r = resignYmdOf(c);
    return r != null && r < today;
  });
}

/**
 * 退職後の成果（元担当 CA ごと）。single なら指定 CA だけ、そうでなければ退職済みの CA 全員。行が無い CA は出さない。
 * ALL（会社全体）にはこの分が既に含まれている（ALL は担当を問わず全行を数える）。
 */
export function buildPostExit<T extends { employee_id: string | null }>(
  roster: RosterCa[],
  targets: RosterCa[],
  single: boolean,
  rows: T[],
  dateOf: (r: T) => Date | null,
  summarize: (rs: T[]) => object,
  opts: { byMonth?: boolean } = {},
): Record<string, unknown>[] {
  const cas = single ? targets.filter((c) => resignYmdOf(c) != null) : exitedCas(roster);
  const out: Record<string, unknown>[] = [];
  for (const ca of cas) {
    const hit = rows.filter((r) => r.employee_id === ca.id && isAfterExit(ca, dateOf(r)));
    if (!hit.length) continue;
    const block: Record<string, unknown> = { ca: ca.employeeNumber, name: ca.name, resignDate: resignYmdOf(ca), total: summarize(hit) };
    if (opts.byMonth) {
      const ms = [...new Set(hit.map((r) => jstMonthOf(dateOf(r))!))].sort();
      block.byMonth = ms.map((m) => ({ month: m, ...summarize(hit.filter((r) => jstMonthOf(dateOf(r)) === m)) }));
    }
    out.push(block);
  }
  return out;
}

/**
 * 稼働しない期間に記録された活動（面談の実施・エントリー）の件数。今の担当CAで数える（他の集計と同じ担当軸）。
 * 捨てずに CA の行に数えているので、件数を warnings で知らせる。
 */
export async function inactiveActivityWarnings(cas: RosterCa[]): Promise<string[]> {
  const withPeriods = cas.filter((c) => c.inactivePeriods.length > 0);
  if (!withPeriods.length) return [];
  // (employee_id, 開始日の JST 0:00 を UTC にした時刻, 終了日翌日の JST 0:00 を UTC にした時刻 or NULL) の表
  const utcStart = (ymd: string) => `(${sqlStr(ymd)}::timestamp - interval '9 hours')`;
  const values = withPeriods
    .flatMap((c) => c.inactivePeriods.map((p) => `(${sqlStr(c.id)}, ${utcStart(p.startDate)}, ${p.endDate ? utcStart(nextYmd(p.endDate)) : "NULL::timestamp"})`))
    .join(", ");
  const rows = await prisma.$queryRawUnsafe<{ employee_id: string; interviews: number; entries: number }[]>(`
    WITH p(employee_id, f, t) AS (VALUES ${values})
    SELECT p.employee_id,
      (SELECT COUNT(*)::int FROM interview_records ir JOIN candidates c ON c.id = ir.candidate_id
        WHERE c.employee_id = p.employee_id AND ${heldInterviewPred("ir")} AND ir.interview_date <= ${NOW_UTC}
          AND ir.interview_date >= p.f AND (p.t IS NULL OR ir.interview_date < p.t)) AS interviews,
      (SELECT COUNT(*)::int FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
        WHERE c.employee_id = p.employee_id AND je.archived_at IS NULL AND je.entry_date IS NOT NULL
          AND je.entry_date >= p.f AND (p.t IS NULL OR je.entry_date < p.t)) AS entries
    FROM p;`);
  const byCa = new Map<string, { interviews: number; entries: number }>();
  for (const r of rows) {
    const x = byCa.get(r.employee_id) ?? { interviews: 0, entries: 0 };
    byCa.set(r.employee_id, { interviews: x.interviews + Number(r.interviews), entries: x.entries + Number(r.entries) });
  }
  const parts = withPeriods
    .map((c) => ({ c, x: byCa.get(c.id) ?? { interviews: 0, entries: 0 } }))
    .filter(({ x }) => x.interviews + x.entries > 0)
    .map(({ c, x }) => `${c.employeeNumber}（${c.name}）面談 ${x.interviews} 件・エントリー ${x.entries} 件`);
  return parts.length
    ? [`稼働しない期間に記録された活動（今の担当CAで数えた件数）: ${parts.join("・")}。捨てずに CA の行・ALL に数えている（代理対応・担当替え前の記録の可能性）`]
    : [];
}

// ---- 集計ヘルパ ---------------------------------------------------------------

export interface Quantiles {
  n: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  mean: number;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/** 分布（最小・四分位・中央値・最大・平均）。標本が閾値未満なら null（伏せる）。 */
export function quantiles(values: number[], threshold = SUPPRESS_THRESHOLD): Quantiles | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length < threshold) return null;
  return {
    n: xs.length,
    min: xs[0],
    p25: r1(pct(xs, 0.25)),
    median: r1(pct(xs, 0.5)),
    p75: r1(pct(xs, 0.75)),
    max: xs[xs.length - 1],
    mean: r1(xs.reduce((s, v) => s + v, 0) / xs.length),
  };
}

/** 分布を返すか、標本不足なら { n, suppressed: true } を返す。 */
export function distribution(values: number[]): Quantiles | { n: number; suppressed: true } {
  const q = quantiles(values);
  return q ?? { n: values.filter((v) => Number.isFinite(v)).length, suppressed: true };
}

/** 割合（小数 3 桁）。分母 0 は null。 */
export function ratio(num: number, den: number): number | null {
  return den > 0 ? Math.round((num / den) * 1000) / 1000 : null;
}

/** 日数差（JST の暦日ベース）。 */
export function daysBetween(from: Date | null | undefined, to: Date | null | undefined): number | null {
  if (!from || !to) return null;
  const a = jstYmd(from)!;
  const b = jstYmd(to)!;
  const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const db = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((db - da) / 86_400_000);
}

export function jstMonthOf(d: Date | null | undefined): string | null {
  return d ? jstYmd(d)!.slice(0, 7) : null;
}

/** 人数が閾値未満（0 を除く）なら true。 */
export function shouldSuppress(people: number): boolean {
  return people > 0 && people < SUPPRESS_THRESHOLD;
}

// ---- 共通の応答部品 -----------------------------------------------------------

export interface HistorySince {
  caAssignment: string | null;
  entryStatus: string | null;
  supportStatus: string | null;
  preference: string | null;
  pipelineSnapshot: string | null;
}

/** 各記録の開始日（最初の行の日時）。行が無ければ null（＝まだ記録が無い）。 */
export async function queryHistorySince(): Promise<HistorySince> {
  const rows = await prisma.$queryRawUnsafe<{ ca: Date | null; es: Date | null; ss: Date | null; pf: Date | null; sn: Date | null }[]>(`
    SELECT
      (SELECT MIN(changed_at) FROM candidate_ca_assignment_histories) AS ca,
      (SELECT MIN(changed_at) FROM job_entry_status_histories) AS es,
      (SELECT MIN(changed_at) FROM candidate_support_status_histories) AS ss,
      (SELECT MIN(changed_at) FROM candidate_preference_histories) AS pf,
      (SELECT MIN(snapshot_date)::timestamp FROM ca_pipeline_daily_snapshots) AS sn;`);
  const r = rows[0];
  return {
    caAssignment: jstYmd(r?.ca ?? null),
    entryStatus: jstYmd(r?.es ?? null),
    supportStatus: jstYmd(r?.ss ?? null),
    preference: jstYmd(r?.pf ?? null),
    // snapshot_date は DATE 列（JST の日付をそのまま持つ）なので UTC として読む
    pipelineSnapshot: r?.sn ? r.sn.toISOString().slice(0, 10) : null,
  };
}

export interface EnvelopeInput {
  tool: string;
  period: Record<string, unknown> | null;
  cas: RosterCa[];
  single: boolean;
  exclusions: string[];
  counts: Record<string, number | null>;
  warnings: string[];
  definitions: Record<string, string>;
  roster?: RosterCa[];
}

/** すべての新ツールが返す共通部分。 */
export async function buildEnvelope(input: EnvelopeInput): Promise<Record<string, unknown>> {
  const rosterForWarnings = input.roster ?? input.cas;
  const [meta, since, inactiveWarn] = await Promise.all([queryCaKpiMeta(), queryHistorySince(), inactiveActivityWarnings(rosterForWarnings)]);
  const warnings = [...rosterWarnings(rosterForWarnings), ...inactiveWarn, ...input.warnings];
  return {
    tool: input.tool,
    definitionVersion: DEFINITION_VERSION,
    generatedAt: jstIso(new Date()),
    observationEnd: todayJstDateString(),
    timezone: "Asia/Tokyo",
    attribution: "current_ca",
    period: input.period,
    cas: input.cas.map(caLabel),
    caScope: input.single ? "single" : "active_cas",
    exclusions: input.exclusions,
    suppression: {
      threshold: SUPPRESS_THRESHOLD,
      rule: `人数（分母）が 1〜${SUPPRESS_THRESHOLD - 1} のグループは内訳を null にして suppressed=true。日数・金額の分布は標本 ${SUPPRESS_THRESHOLD} 未満なら null`,
    },
    dataFreshness: {
      interview_records: jstIso(meta.interviewRecordsUpdatedAt),
      job_entries: jstIso(meta.jobEntriesUpdatedAt),
      candidate_files: jstIso(meta.candidateFilesUpdatedAt),
    },
    historySince: since,
    counts: input.counts,
    warnings,
    definitions: input.definitions,
  };
}

/** 応答サイズの上限。超えていればエラー文（呼び出し側で isError にする）。 */
export function checkResponseSize(body: unknown): string | null {
  const bytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  if (bytes <= MAX_RESPONSE_BYTES) return null;
  return `応答が大きすぎます（約 ${Math.round(bytes / 1000)}KB・上限 ${Math.round(MAX_RESPONSE_BYTES / 1000)}KB）。期間を短くする・caId で 1 人に絞る・byCa=false にして呼び直してください`;
}

/** 月の行を CA ごとに作るときの共通: 在籍月のみ。入社日未登録なら全月。 */
export function tenureMonthsFor(ca: RosterCa, months: string[]): string[] {
  return months.filter((m) => inTenureMonth(ca, m));
}

export const COMMON_DEFINITIONS = {
  attribution: "担当CAは求職者の『今の』担当（candidates.employee_id）。担当替え記録（historySince.caAssignment）より前の担当替えは分からない",
  firstInterview: "その求職者の面談記録のうち result_flag が辞退系（連絡なし辞退・連絡あり辞退・辞退）でも日程再調整でもなく、面談日が過去の最も早い 1 件。interview_count は使わない",
  tenure: "在籍CA＝job_category='CA'。CA別の月の行は入社月〜退職月だけ返す。入社月・退職月・稼働しない期間を含む月は availability（稼働日数・稼働人月）で按分する。入社日未登録の CA は全月を返し warnings に出す",
  availability: "CA の月の行の availability: calendarDays=その月の暦日数、activeDays=稼働日数（入社日〜退職日の在籍日から稼働しない期間の日を除いた暦日数・土日祝を区別しない）、inactiveDays=在籍日のうち稼働しない期間の日数、fte=稼働人月（activeDays ÷ calendarDays・小数 3 桁。月の半分なら 0.5）。期間合計の行の activeMonths は fte の合計。CA 平均・1人あたりは fte（activeMonths）の合計で割る。fte=0 の月は分母に入れない（活動 0 として評価しない）",
  inactivePeriods: "稼働しない期間（休業など）は退職後・入社前と同じく在籍していない日として扱う。保存しているのは期間の日付だけで理由は持たない。その期間に記録された活動は捨てずに CA の行と ALL に数え、件数を warnings に出す",
  postExit: "退職後の成果: 退職日（resign_date・JST）より後の日付で起きたエントリー・選考・承諾・承諾売上・今の進行中案件。ALL（会社全体）には含める。CA の行からは外し、元担当 CA ごとに postExit に分けて返す（ALL と CA 行の合計の差には postExit・担当なし・CA 以外の担当の分が入る）。退職後の月は稼働人月 0 なので活動の平均の分母に入れない（新規の面談などの活動は退職日まで）",
  reference: `${RELIABLE_FROM_MONTH} より前の月は FileMaker 移行データが混ざるため参考値（reference=true）`,
  suppression: `人数 1〜${SUPPRESS_THRESHOLD - 1} のグループは内訳を伏せる（suppressed=true）。分布は標本 ${SUPPRESS_THRESHOLD} 未満で伏せる`,
  counts: "records=件数（案件）、candidates/people=人数（求職者ユニーク）。期間のユニーク人数は期間全体で重複を除くので月の合計と一致しない",
  dates: "すべて JST の暦日。日数は暦日の差",
} as const;
