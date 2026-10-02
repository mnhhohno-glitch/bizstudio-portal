// T-XXX step5C: get_accept_revenue — 承諾売上・求人DB費・仕入・粗利を CA別 × 承諾月、単価の分布、承諾後辞退を分けた値。
//
// 「承諾売上」は job_entries.revenue（税抜・円）を承諾日（acceptance_date）の月で合計したもの。請求・入金ではない。
// 既存 company-kpi の invoiceRevenue / grossProfit と同じ行（承諾日あり・未アーカイブ）を母集団にし、
// 承諾後辞退（acceptedThenDeclined）をその内数として分けて返す（既存の数字は変えない）。
import { loadEntryRows, outcomeOf, type EntryRow } from "./conversion";
import {
  buildEnvelope, resolveCas, resolveMonthRange, jstMonthOf, distribution, ratio, tenureMonthsFor, checkResponseSize,
  COMMON_DEFINITIONS, RELIABLE_FROM_MONTH, ALL_KEY, type RosterCa,
  inCaScope, availabilityBlock, activeMonthsOf, buildPostExit,
} from "./common";

const gross = (r: EntryRow): number | null => (r.revenue == null ? null : r.revenue - (r.job_db_cost ?? 0) - (r.cost ?? 0));

export function summarizeRevenue(rows: EntryRow[]) {
  const declined = rows.filter((r) => outcomeOf(r) === "acceptedThenDeclined");
  const withRev = rows.filter((r) => r.revenue != null);
  const sum = (xs: EntryRow[], f: (r: EntryRow) => number | null) => xs.reduce((s, r) => s + (f(r) ?? 0), 0);
  const feeType: Record<string, number> = {};
  for (const r of rows) feeType[r.fee_type ?? "unset"] = (feeType[r.fee_type ?? "unset"] ?? 0) + 1;
  const now = new Date();
  return {
    deals: rows.length,
    people: new Set(rows.map((r) => r.candidate_id)).size,
    revenue: sum(rows, (r) => r.revenue),
    jobDbCost: sum(rows, (r) => r.job_db_cost),
    cost: sum(rows, (r) => r.cost),
    grossProfit: sum(withRev, gross),
    missing: {
      revenue: rows.length - withRev.length,
      jobDbCost: rows.filter((r) => r.job_db_cost == null).length,
      cost: rows.filter((r) => r.cost == null).length,
    },
    acceptedThenDeclined: { deals: declined.length, revenue: sum(declined, (r) => r.revenue), grossProfit: sum(declined.filter((r) => r.revenue != null), gross) },
    net: {
      deals: rows.length - declined.length,
      revenue: sum(rows, (r) => r.revenue) - sum(declined, (r) => r.revenue),
      grossProfit: sum(withRev, gross) - sum(declined.filter((r) => r.revenue != null), gross),
    },
    unitPrice: distribution(withRev.map((r) => r.revenue as number)),
    grossPerDeal: distribution(withRev.map((r) => gross(r) as number)),
    averageUnitPrice: withRev.length ? Math.round(sum(withRev, (r) => r.revenue) / withRev.length) : null,
    feeType,
    joinDate: {
      missing: rows.filter((r) => !r.join_at).length,
      future: rows.filter((r) => r.join_at && r.join_at.getTime() > now.getTime()).length,
      past: rows.filter((r) => r.join_at && r.join_at.getTime() <= now.getTime()).length,
    },
    acceptedThenDeclinedRate: ratio(declined.length, rows.length),
  };
}

export async function buildAcceptRevenue(input: { from?: string; to?: string; caId?: string; byCa?: boolean }): Promise<Record<string, unknown>> {
  const { from, to, months } = resolveMonthRange(input.from, input.to, { from: RELIABLE_FROM_MONTH });
  const { roster, targets, single } = await resolveCas(input.caId);
  const byCa = input.byCa ?? true;
  const rows = await loadEntryRows(from, to, { basis: "acceptance" });
  const byMonth = new Map<string, EntryRow[]>();
  for (const r of rows) {
    const m = jstMonthOf(r.acceptance_at)!;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(r);
  }
  const groupRow = (ca: RosterCa | null, month: string | null, rs: EntryRow[]) => ({
    ca: ca ? ca.employeeNumber : ALL_KEY,
    month,
    reference: month ? month < RELIABLE_FROM_MONTH : false,
    ...(ca && month ? { availability: availabilityBlock(ca, month) } : {}),
    ...(ca && !month ? { activeMonths: activeMonthsOf(ca, tenureMonthsFor(ca, months)) } : {}),
    ...summarizeRevenue(rs),
  });
  const monthRows: Record<string, unknown>[] = [];
  for (const m of months) {
    const rs = byMonth.get(m) ?? [];
    if (!single) monthRows.push(groupRow(null, m, rs));
    if (byCa || single) {
      for (const ca of targets) {
        if (!tenureMonthsFor(ca, [m]).length) continue;
        monthRows.push(groupRow(ca, m, rs.filter((r) => r.employee_id === ca.id && inCaScope(ca, r.acceptance_at))));
      }
    }
  }
  const totalRows: Record<string, unknown>[] = [];
  if (!single) totalRows.push(groupRow(null, null, rows));
  for (const ca of targets) {
    totalRows.push(groupRow(ca, null, rows.filter((r) => r.employee_id === ca.id && inCaScope(ca, r.acceptance_at))));
  }
  // 退職後に承諾した案件（ALL・会社全体の承諾売上には含まれている）を元担当 CA ごとに分ける
  const postExit = buildPostExit(roster, targets, single, rows, (r) => r.acceptance_at, summarizeRevenue, { byMonth: true });
  const env = await buildEnvelope({
    tool: "get_accept_revenue",
    period: { from, to, months: months.length, basis: "承諾日（acceptance_date）の JST 月" },
    cas: targets,
    single,
    roster,
    exclusions: ["アーカイブ済みのエントリー", "承諾日が無い行（売上が入っていても数えない。FileMaker 移行分の承諾日なし売上はここに入らない）"],
    counts: { deals: rows.length, people: new Set(rows.map((r) => r.candidate_id)).size, revenueMissing: rows.filter((r) => r.revenue == null).length },
    warnings: [
      "『承諾売上』であり請求・入金ではない。確定/見込・取消・返金・減額の列は無い",
      "ALL の revenue / grossProfit は get_company_kpi の invoiceRevenue / grossProfit と同じ母集団（差があれば ALL に担当なし・CA 以外の担当分が入っていることと、月の端数の違いだけ）。承諾後辞退分は既存ツールにも含まれているので、新ツールの net（承諾後辞退を除いた値）とは差がある",
      "承諾件数が少ない（月 2〜10 件）ので単価の分布は幅が大きい。CA 別 × 月では分布は伏せられることが多い",
    ],
    definitions: {
      revenue: "承諾売上（job_entries.revenue・税抜・円）の合計。年収％方式は理論年収 × 料率をサーバーで計算した値、固定方式は入力値",
      jobDbCost: "求人DB費（job_db_cost・円）の合計",
      cost: "仕入（cost・外部コスト・円）の合計",
      grossProfit: "粗利 = revenue − job_db_cost − cost（売上が入っている行だけ。未入力は 0 として引く）",
      acceptedThenDeclined: "承諾日がある行のうち、今の状態が本人辞退（entry_flag_detail が本人辞退系、または 辞退受付済/辞退報告済）の件数と売上。既存ツールの承諾件数・売上にはこれが含まれている",
      net: "承諾 − 承諾後辞退",
      unitPrice: "1 件あたりの承諾売上の分布（売上が入っている行だけ。標本 5 未満は伏せる）",
      feeType: "課金方式の件数（ANNUAL_RATE=年収％ / FIXED=固定 / unset=未設定）",
      joinDate: "入社日の入力状況（missing=未入力・future=未来日＝入社予定・past=過去日）。入社予定日と実入社日の区別は無い",
      people: "承諾した求職者ユニーク。同じ人が複数社で承諾すると deals > people",
      attribution: COMMON_DEFINITIONS.attribution,
      tenure: COMMON_DEFINITIONS.tenure,
      availability: COMMON_DEFINITIONS.availability,
      inactivePeriods: COMMON_DEFINITIONS.inactivePeriods,
      postExit: COMMON_DEFINITIONS.postExit + "。このツールでは承諾日が退職日より後の案件の承諾売上・粗利。ALL の revenue / grossProfit に含まれ、CA の行の total には入らない",
      suppression: "件数・合計金額は伏せない（既存 get_company_kpi と同じ）。分布だけ標本 5 未満で伏せる",
      reference: COMMON_DEFINITIONS.reference,
    },
  });
  const body = { ...env, currency: "JPY", taxBasis: "税抜", byMonth: monthRows, total: totalRows, postExit };
  const tooBig = checkResponseSize(body);
  if (tooBig) throw new Error(tooBig);
  return body;
}
