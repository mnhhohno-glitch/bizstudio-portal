// T-XXX step5C: get_forecast_inputs — 予測売上に必要な材料をまとめて返す（予測そのものは計算しない）。
//
// 返すもの: 各段階から承諾へ進んだ割合と残り日数の分布、初回面談→承諾の割合と日数、単価・粗利の分布、承諾後辞退の割合、
//           今の進行中案件、今後の面談予約、観測終了日、結果待ち件数。
import { loadEntryRows, outcomeOf, stageDateOf, type EntryRow, type SelStage } from "./conversion";
import { loadCohortRows } from "./cohort";
import { summarizeRevenue } from "./revenue";
import { computePipelineSnapshotRows, SNAPSHOT_CA_KEY_ALL } from "@/lib/pipeline-snapshot";
import {
  buildEnvelope, resolveCas, resolveMonthRange, daysBetween, distribution, ratio, tenureMonthsFor, jstMonthOf, checkResponseSize,
  COMMON_DEFINITIONS, RELIABLE_FROM_MONTH, ALL_KEY, type RosterCa,
} from "./common";
import { todayJstDateString } from "@/lib/dailyReport/jstDate";

const FORECAST_STAGES: SelStage[] = ["documentSubmit", "documentPass", "companyInterview", "offer"];

function stageToAcceptance(rows: EntryRow[]) {
  const out: Record<string, unknown> = {};
  const entered = rows;
  const block = (label: string, hit: EntryRow[], anchor: (r: EntryRow) => Date | null) => {
    const accepted = hit.filter((r) => r.acceptance_at);
    const negative = hit.filter((r) => ["declined", "rejected", "closed"].includes(outcomeOf(r)));
    const inProgress = hit.filter((r) => outcomeOf(r) === "inProgress");
    const unknown = hit.length - accepted.length - negative.length - inProgress.length;
    out[label] = {
      reached: hit.length,
      acceptedAfter: accepted.length,
      resolvedNegative: negative.length,
      inProgress: inProgress.length,
      unknown,
      acceptanceRateAmongAll: ratio(accepted.length, hit.length),
      acceptanceRateAmongResolved: ratio(accepted.length, accepted.length + negative.length),
      daysToAcceptance: distribution(accepted.map((r) => daysBetween(anchor(r), r.acceptance_at) ?? NaN)),
      // 辞退・見送りの日付は historySince.entryStatus より前は無いので、終了までの日数は返さない
      daysToNegative: null,
    };
  };
  block("entered", entered, (r) => r.entry_at);
  for (const s of FORECAST_STAGES) block(s, rows.filter((r) => stageDateOf(r, s) != null), (r) => stageDateOf(r, s));
  return out;
}

export async function buildForecastInputs(input: { baseFrom?: string; baseTo?: string; caId?: string }): Promise<Record<string, unknown>> {
  const { from, to, months } = resolveMonthRange(input.baseFrom, input.baseTo, { from: RELIABLE_FROM_MONTH });
  const { roster, targets, single } = await resolveCas(input.caId);
  const [entryRows, cohortRows, acceptRows, snap] = await Promise.all([
    loadEntryRows(from, to),
    loadCohortRows(from, to),
    loadEntryRows(from, to, { basis: "acceptance" }),
    computePipelineSnapshotRows(),
  ]);
  const snapByKey = new Map(snap.map((r) => [r.caKey, r]));
  const perScope = (ca: RosterCa | null) => {
    const okMonths = ca ? new Set(tenureMonthsFor(ca, months)) : null;
    const er = ca ? entryRows.filter((r) => r.employee_id === ca.id && okMonths!.has(jstMonthOf(r.entry_at)!)) : entryRows;
    const cr = ca ? cohortRows.filter((r) => r.employee_id === ca.id && okMonths!.has(jstMonthOf(r.first_at)!)) : cohortRows;
    const ar = ca ? acceptRows.filter((r) => r.employee_id === ca.id && okMonths!.has(jstMonthOf(r.acceptance_at)!)) : acceptRows;
    const s = snapByKey.get(ca ? ca.id : SNAPSHOT_CA_KEY_ALL);
    const cohortAccepted = cr.filter((r) => r.acceptance_at);
    const cohortObserving = cr.filter((r) => !r.acceptance_at && (r.in_selection || r.support_status === "ACTIVE" || r.support_status === "WAITING"));
    const rev = summarizeRevenue(ar);
    return {
      ca: ca ? ca.employeeNumber : ALL_KEY,
      stageToAcceptance: stageToAcceptance(er),
      firstInterviewToAcceptance: {
        people: cr.length,
        accepted: cohortAccepted.length,
        observing: cohortObserving.length,
        ended: cr.length - cohortAccepted.length - cohortObserving.length,
        rateAmongAll: ratio(cohortAccepted.length, cr.length),
        rateAmongResolved: ratio(cohortAccepted.length, cr.length - cohortObserving.length),
        daysToAcceptance: distribution(cohortAccepted.map((r) => daysBetween(r.first_at, r.acceptance_at) ?? NaN)),
        daysToFirstEntry: distribution(cr.filter((r) => r.entry_at).map((r) => daysBetween(r.first_at, r.entry_at) ?? NaN)),
      },
      revenue: {
        deals: rev.deals,
        unitPrice: rev.unitPrice,
        grossPerDeal: rev.grossPerDeal,
        averageUnitPrice: rev.averageUnitPrice,
        acceptedThenDeclinedRate: rev.acceptedThenDeclinedRate,
        acceptedThenDeclinedDeals: rev.acceptedThenDeclined.deals,
      },
      pipelineNow: s
        ? {
            entered: s.entered,
            documentScreening: s.documentScreening,
            firstInterview: s.firstInterview,
            secondInterview: s.secondInterview,
            finalInterview: s.finalInterview,
            interviewOther: s.interviewOther,
            offered: s.offered,
            inSelection: { records: s.inSelectionRecords, people: s.inSelectionCandidates },
            acceptedNotJoined: s.acceptedNotJoined,
            activeCandidates: s.activeCandidates,
            upcomingInterviews: { first: s.upcomingInterviewsFirst, existing: s.upcomingInterviewsExisting },
          }
        : null,
      pending: {
        entriesInProgress: er.filter((r) => outcomeOf(r) === "inProgress").length,
        cohortObserving: cohortObserving.length,
      },
    };
  };
  const scopes: Record<string, unknown>[] = [];
  if (!single) scopes.push(perScope(null));
  for (const ca of targets) scopes.push(perScope(ca));
  const env = await buildEnvelope({
    tool: "get_forecast_inputs",
    period: { baseFrom: from, baseTo: to, months: months.length, note: "割合・日数・単価の学習期間。進行中案件・面談予約は取得時点" },
    cas: targets,
    single,
    roster,
    exclusions: ["アーカイブ済みのエントリー", "期間前の案件・コホート"],
    counts: { baseEntries: entryRows.length, baseCohortPeople: cohortRows.length, baseDeals: acceptRows.length },
    warnings: [
      "予測はここでは計算しない。ChatGPT 側で『進行中案件 × 段階ごとの承諾率 × 単価』と『今後の面談予約 × 初回面談→承諾率 × 単価』を分けて計算し、同じ求職者を二重に数えない（面談予約からの見込みは、まだ案件が無い人の分だけに使う）",
      "承諾は 5 か月で数十件しか無いので、割合は幅（保守的＝rateAmongAll・標準＝rateAmongResolved の中間・好調＝rateAmongResolved）で扱う",
      "CA 別に割ると標本が小さく分布が伏せられる。伏せられた切り口は ALL の値を使い、その前提を明記する",
      `観測終了日 ${todayJstDateString()}。pending の件数は結果待ちで、直近の月ほど多い`,
    ],
    definitions: {
      stageToAcceptance: "学習期間にエントリーした案件のうち、その段階に到達した件数（reached）と、その後承諾した件数（acceptedAfter）・終了した件数（resolvedNegative）・選考中（inProgress）・不明（unknown）。acceptanceRateAmongResolved は 承諾 ÷（承諾＋終了）で選考中を分母に入れない。daysToAcceptance はその段階の日付から承諾日までの暦日数",
      firstInterviewToAcceptance: "学習期間に初回面談した求職者のうち承諾した人の割合と日数（人数ベース）",
      revenue: "学習期間に承諾した案件の単価・粗利の分布と承諾後辞退の割合（get_accept_revenue と同じ定義・税抜・円）",
      pipelineNow: "取得時点の進行中案件（get_pipeline_now と同じ定義）と今後の面談予約",
      pending: "結果待ち: entriesInProgress=学習期間の案件で選考中、cohortObserving=学習期間のコホートで承諾なし・活動中",
      attribution: COMMON_DEFINITIONS.attribution,
      tenure: COMMON_DEFINITIONS.tenure,
      suppression: COMMON_DEFINITIONS.suppression,
    },
  });
  const body = { ...env, scopes };
  const tooBig = checkResponseSize(body);
  if (tooBig) throw new Error(tooBig);
  return body;
}
