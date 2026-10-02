// T-XXX step5C: get_ca_roster — CA 一覧と在籍期間、今の担当人数・活動中・選考中・承諾済み未入社。
import { prisma } from "@/lib/prisma";
import { entryStageCaseSql } from "@/lib/aiRead/caKpi";
import { todayJstDateString } from "@/lib/dailyReport/jstDate";
import { jstYmd } from "@/lib/aiRead/caKpiResponse";
import {
  buildEnvelope, loadRoster, isDefaultCa, monthsBetween, currentMonthJst, availabilityOf, exitedCas, resignYmdOf,
  COMMON_DEFINITIONS, RELIABLE_FROM_MONTH, ALL_KEY, type RosterCa,
} from "./common";

type Raw = Record<string, unknown> & { grp: string };
const n = (v: unknown): number => (typeof v === "number" ? v : v == null ? 0 : Number(v));

export async function buildCaRoster(): Promise<Record<string, unknown>> {
  const roster = await loadRoster();
  const GRP = `CASE WHEN GROUPING(c.employee_id) = 1 THEN '${ALL_KEY}' ELSE COALESCE(c.employee_id, '') END AS grp`;
  const [assigned, sel] = await Promise.all([
    prisma.$queryRawUnsafe<Raw[]>(`
      SELECT ${GRP},
        COUNT(*)::int AS assigned,
        COUNT(*) FILTER (WHERE c.support_status IN ('ACTIVE','WAITING'))::int AS active_cnt,
        COUNT(*) FILTER (WHERE c.support_status = 'BEFORE')::int AS before_cnt
      FROM candidates c
      GROUP BY GROUPING SETS ((c.employee_id), ());`),
    prisma.$queryRawUnsafe<Raw[]>(`
      SELECT ${GRP},
        COUNT(*) FILTER (WHERE x.stage IN ('documentScreening','firstInterview','secondInterview','finalInterview','interviewOther','offered'))::int AS in_sel_recs,
        COUNT(DISTINCT x.candidate_id) FILTER (WHERE x.stage IN ('documentScreening','firstInterview','secondInterview','finalInterview','interviewOther','offered'))::int AS in_sel_cands,
        COUNT(*) FILTER (WHERE x.stage = 'acceptedNotJoined')::int AS accepted_not_joined
      FROM (
        SELECT je.candidate_id, ${entryStageCaseSql()} AS stage
        FROM job_entries je WHERE je.archived_at IS NULL AND je.is_active = TRUE
      ) x JOIN candidates c ON c.id = x.candidate_id
      WHERE x.stage IS NOT NULL
      GROUP BY GROUPING SETS ((c.employee_id), ());`),
  ]);
  const byKey = new Map<string, Record<string, number>>();
  for (const r of assigned) byKey.set(r.grp, { assigned: n(r.assigned), active: n(r.active_cnt), before: n(r.before_cnt) });
  for (const r of sel) {
    const x = byKey.get(r.grp) ?? {};
    byKey.set(r.grp, { ...x, inSelRecs: n(r.in_sel_recs), inSelCands: n(r.in_sel_cands), acceptedNotJoined: n(r.accepted_not_joined) });
  }
  const today = todayJstDateString();
  const curMonth = currentMonthJst();
  // 稼働日数を返す月: 信頼できる期間の開始（2026-05）〜今月
  const availabilityMonths = monthsBetween(RELIABLE_FROM_MONTH, curMonth);
  const row = (ca: RosterCa) => {
    const x = byKey.get(ca.id) ?? {};
    const from = ca.tenureFromMonth;
    const to = ca.tenureToMonth ?? curMonth;
    return {
      employeeNumber: ca.employeeNumber,
      name: ca.name,
      status: ca.status,
      inDefaultAggregation: isDefaultCa(ca, today),
      hireDate: jstYmd(ca.hireDate),
      resignDate: jstYmd(ca.resignDate),
      registration: { hireDateRegistered: !!ca.hireDate, resignDateRegistered: !!ca.resignDate },
      // (step6) 稼働しない期間（日付だけ。理由は返さない）と月ごとの稼働日数
      inactivePeriods: ca.inactivePeriods.map((p) => ({ startDate: p.startDate, endDate: p.endDate })),
      availabilityByMonth: availabilityMonths
        .map((m) => availabilityOf(ca, m))
        .map((a) => ({ month: a.month, calendarDays: a.calendarDays, employedDays: a.employedDays, inactiveDays: a.inactiveDays, activeDays: a.activeDays, fte: a.fte })),
      tenure: {
        fromMonth: from,
        toMonth: ca.tenureToMonth,
        monthsThroughNow: from ? monthsBetween(from, to).length : null,
        note: from ? null : "入社日未登録のため在籍月数は不明",
      },
      current: {
        assignedCandidates: x.assigned ?? 0,
        activeCandidates: x.active ?? 0,
        beforeInterviewCandidates: x.before ?? 0,
        inSelection: { records: x.inSelRecs ?? 0, candidates: x.inSelCands ?? 0 },
        acceptedNotJoined: x.acceptedNotJoined ?? 0,
      },
    };
  };
  const all = byKey.get(ALL_KEY) ?? {};
  const env = await buildEnvelope({
    tool: "get_ca_roster",
    period: null,
    cas: roster,
    single: false,
    exclusions: ["職種が CA 以外の社員（スカウト担当・事務など）は一覧に含めない。担当として求職者を持っていても ALL にだけ入る"],
    counts: {
      cas: roster.length,
      defaultCas: roster.filter((c) => isDefaultCa(c, today)).length,
      withInactivePeriods: roster.filter((c) => c.inactivePeriods.length > 0).length,
      exited: exitedCas(roster, today).length,
    },
    warnings: [
      ...roster
        .filter((c) => isDefaultCa(c, today) && c.inactivePeriods.some((p) => p.startDate <= today && (p.endDate == null || today <= p.endDate)))
        .map((c) => `${c.employeeNumber}（${c.name}）は今日が稼働しない期間に入っている。在籍CAとして一覧に出るが、その期間の月は availabilityByMonth の fte が下がる（CA 平均の分母から外す）`),
      ...exitedCas(roster, today).map(
        (c) => `${c.employeeNumber}（${c.name}）は退職済み（退職日 ${resignYmdOf(c)}）。今も担当として持っている案件・退職後の成果は各ツールの postExit に分けて返す（ALL には含まれる）`,
      ),
    ],
    definitions: {
      caJudgement: "CA かどうか＝employees.job_category='CA'。在籍＝status='active' かつ退職日が無いか未来",
      tenure: COMMON_DEFINITIONS.tenure,
      inactivePeriods: COMMON_DEFINITIONS.inactivePeriods + "。inactivePeriods は期間（startDate〜endDate・endDate=null は終了未定）だけを返す",
      availabilityByMonth: `${RELIABLE_FROM_MONTH}〜今月の月ごとの稼働。${COMMON_DEFINITIONS.availability}。employedDays=在籍日数（入社日〜退職日と月の重なり。入社日未登録は月初から在籍とみなす）`,
      postExit: COMMON_DEFINITIONS.postExit,
      assignedCandidates: "candidates.employee_id がその CA の求職者数（FileMaker 移行分を含むため大きい）",
      activeCandidates: "support_status が ACTIVE または WAITING の人数",
      inSelection: "有効（is_active・未アーカイブ）なエントリーのうち段階が 書類選考〜内定（承諾前）の件数・人数",
      acceptedNotJoined: "entry_flag='内定' かつ acceptance_date あり（承諾済みで入社済にまだなっていない）件数",
      attribution: COMMON_DEFINITIONS.attribution,
    },
  });
  return {
    ...env,
    all: {
      assignedCandidates: all.assigned ?? 0,
      activeCandidates: all.active ?? 0,
      inSelection: { records: all.inSelRecs ?? 0, candidates: all.inSelCands ?? 0 },
      acceptedNotJoined: all.acceptedNotJoined ?? 0,
    },
    cas: roster.map(row),
  };
}
