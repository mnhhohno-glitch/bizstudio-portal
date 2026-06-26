// T-071 直近6ヶ月 コホート率 API。
// その月にエントリーした候補者を母集団（コホート）に、後段階へ進んだかを追跡する（月窓に縛らない）。
//   - コホート＝その月に entryDate を持つ候補者（候補者ユニーク・post-app・担当軸・archived除く・無効含む）。
//   - 書類通過率＝コホートのうち documentPassDate を持つ人数 ÷ コホート人数
//   - 内定率＝コホートのうち offerDate を持つ人数 ÷ 書類通過した人数
//   - 承諾率＝コホートのうち acceptanceDate を持つ人数 ÷ 内定した人数
//   ※月をまたいで内定しても、起点月コホートの内定として数える（段階日付の有無で判定）。
// 対象：6ヶ月前〜前月（当月は含まない）。JST 基準。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { todayJstDateString } from "@/lib/dailyReport/jstDate";
import { computeWeeklyMatrix } from "@/lib/performance/weeklyMatrix";

function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map((s) => parseInt(s, 10));
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
function monthStartTs(ym: string): string {
  // UTC wall-clock リテラル（timestamp 無tz 列が UTC 保存のため）。JST 月初 0:00 = 前日 UTC 15:00。
  return new Date(`${ym}-01T00:00:00+09:00`).toISOString().replace("T", " ").replace("Z", "");
}
function nextMonthStartTs(ym: string): string {
  return new Date(`${shiftMonth(ym, 1)}-01T00:00:00+09:00`).toISOString().replace("T", " ").replace("Z", "");
}
function rate(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employeeId");
  const months = Math.min(12, Math.max(1, parseInt(searchParams.get("months") || "6", 10)));
  if (!employeeId) return NextResponse.json({ error: "employeeId が必要です" }, { status: 400 });

  const allCas = employeeId === "all";
  let employee: { id: string; name: string };
  if (allCas) {
    employee = { id: "all", name: "全員" };
  } else {
    const found = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true } });
    if (!found) return NextResponse.json({ error: "employee not found" }, { status: 404 });
    employee = found;
  }
  const empPred = allCas ? "TRUE" : `c.employee_id = '${employeeId}'`;

  // 当月を含まない：前月（-1）から months ヶ月分さかのぼる。
  const thisMonth = todayJstDateString().slice(0, 7);
  const targetMonths: string[] = [];
  for (let i = months; i >= 1; i--) targetMonths.push(shiftMonth(thisMonth, -i));

  // 新規/既存(scoped)は直近6ヶ月全体でランク付け（各月=cell, ランク窓=全期間）→ Σ月=合計。
  const cohortRankWindow = {
    from: new Date(`${targetMonths[0]}-01T00:00:00+09:00`),
    to: new Date(new Date(`${shiftMonth(targetMonths[targetMonths.length - 1], 1)}-01T00:00:00+09:00`).getTime() - 1),
  };

  // 各月の userId 解決（全員は不要）。個別は employee の userId が要る（求人紹介＝User.id 軸）。
  let userId = "__nonexistent__";
  if (!allCas) {
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { userId: true } });
    userId = emp?.userId ?? "__nonexistent__";
  }

  // 月別 funnel SQL（共通化：レンジを引数化）。
  const runFunnel = (mStart: string, mEnd: string) =>
    prisma.$queryRawUnsafe<{ cohort: number; dp: number; offer: number; accept: number; dp_recs: number; offer_recs: number; accept_recs: number }[]>(`
      WITH cohort AS (
        SELECT DISTINCT je.candidate_id
        FROM job_entries je JOIN candidates c ON c.id = je.candidate_id
        WHERE ${empPred} AND je.archived_at IS NULL
          AND je.entry_flag IN ('応募','エントリー','書類選考','面接','内定','入社済')
          AND je.entry_date >= TIMESTAMP '${mStart}' AND je.entry_date < TIMESTAMP '${mEnd}'
      ),
      progressed AS (
        SELECT co.candidate_id,
          BOOL_OR(je.document_pass_date IS NOT NULL) AS has_dp,
          BOOL_OR(je.offer_date IS NOT NULL) AS has_offer,
          BOOL_OR(je.acceptance_date IS NOT NULL) AS has_accept
        FROM cohort co JOIN job_entries je ON je.candidate_id = co.candidate_id
        WHERE je.archived_at IS NULL
        GROUP BY co.candidate_id
      ),
      ev AS (
        -- 件数（社数）: コホート候補者の job_entries で各段階日付を持つ行数（人数とは別軸）。
        SELECT
          COUNT(*) FILTER (WHERE je.document_pass_date IS NOT NULL)::int dp_recs,
          COUNT(*) FILTER (WHERE je.offer_date IS NOT NULL)::int offer_recs,
          COUNT(*) FILTER (WHERE je.acceptance_date IS NOT NULL)::int accept_recs
        FROM cohort co JOIN job_entries je ON je.candidate_id = co.candidate_id
        WHERE je.archived_at IS NULL
      )
      SELECT
        (SELECT COUNT(*) FROM cohort)::int cohort,
        COUNT(*) FILTER (WHERE has_dp)::int dp,
        COUNT(*) FILTER (WHERE has_offer)::int offer,
        COUNT(*) FILTER (WHERE has_accept)::int accept,
        (SELECT dp_recs FROM ev)::int dp_recs,
        (SELECT offer_recs FROM ev)::int offer_recs,
        (SELECT accept_recs FROM ev)::int accept_recs
      FROM progressed;`);

  // 月別 result と internal な cohortBase（その月のコホート＝entry した人数）を並走で算出。
  const monthCalcs = await Promise.all(
    targetMonths.map(async (ym) => {
      const mStart = monthStartTs(ym);
      const mEnd = nextMonthStartTs(ym); // 排他
      const from = new Date(`${ym}-01T00:00:00+09:00`);
      const to = new Date(new Date(`${shiftMonth(ym, 1)}-01T00:00:00+09:00`).getTime() - 1);

      const [funnelRows, mx] = await Promise.all([
        runFunnel(mStart, mEnd),
        computeWeeklyMatrix({ employeeId, userId, from, to, allCas, rankWindow: cohortRankWindow }),
      ]);

      const r = funnelRows[0] ?? { cohort: 0, dp: 0, offer: 0, accept: 0 };
      return {
        cohortBase: r.cohort, // internal: 平均率（隣接段比）計算用。レスポンスには含めない。
        row: {
          yearMonth: ym,
          // 面談（月別人数・record）。%（構成比）は UI で ÷合計面談。
          interview: { first: mx.interview.first, second: mx.interview.second, thirdPlus: mx.interview.thirdPlus, total: mx.interview.total },
          // 求人紹介（期間内 初回/2回目以降・件数=scoped）。% は UI で ÷合計提案。pure=純粋新規。
          proposal: { fresh: mx.proposal.scoped.fresh, existing: mx.proposal.scoped.existing, total: mx.proposal.scoped.total },
          proposalPure: mx.proposal.scoped.pureFresh,
          // エントリー（期間内 初回/2回目以降・件数=scoped）。% は UI で ÷合計エントリー。
          entry: { fresh: mx.entry.scoped.fresh, existing: mx.entry.scoped.existing, total: mx.entry.scoped.total },
          entryPure: mx.entry.scoped.pureFresh,
          // 選考（コホート隣接段階基準・前段が分母）。recs=件数(社数)
          documentPass: r.dp,
          offer: r.offer,
          decided: r.accept, // 決定数＝内定承諾
          documentPassRecs: r.dp_recs,
          offerRecs: r.offer_recs,
          decidedRecs: r.accept_recs,
          documentPassRate: rate(r.dp, r.cohort), // ÷コホートエントリー
          offerRate: rate(r.offer, r.dp), // ÷書類通過
          decidedRate: rate(r.accept, r.offer), // ÷内定
          // 決定売上・売上単価（月窓の revenue 集計。%は出さない）
          decidedRevenue: mx.selection.decidedRevenue,
          decidedUnitPrice: mx.selection.decidedUnitPrice,
        },
      };
    }),
  );
  const results = monthCalcs.map((x) => x.row);

  // T-071 ③ 合計列：6ヶ月通算で再集計（人数系＝COUNT DISTINCT、件数系＝加算、率＝通算コホート率）。
  // 月別の単純和ではない。同じ候補者が複数月に出ても1人。
  const summaryRange = {
    mStart: monthStartTs(targetMonths[0]),
    mEnd: nextMonthStartTs(targetMonths[targetMonths.length - 1]),
    from: new Date(`${targetMonths[0]}-01T00:00:00+09:00`),
    to: new Date(new Date(`${shiftMonth(targetMonths[targetMonths.length - 1], 1)}-01T00:00:00+09:00`).getTime() - 1),
  };
  const [summaryFunnelRows, summaryMx] = await Promise.all([
    runFunnel(summaryRange.mStart, summaryRange.mEnd),
    computeWeeklyMatrix({ employeeId, userId, from: summaryRange.from, to: summaryRange.to, allCas, rankWindow: cohortRankWindow }),
  ]);
  const sr = summaryFunnelRows[0] ?? { cohort: 0, dp: 0, offer: 0, accept: 0 };
  // 売上は月の加算（決定売上＝粗利は単純合計）。売上単価は通算売上 ÷ 通算決定人数。
  const sumRevenue = results.reduce((s, r) => s + (r.decidedRevenue ?? 0), 0);
  // 合計列の人数・件数（提案/エントリー/選考）は各月の合算にする（縦横一致・DISTINCT 再集計しない）。
  // 率（コホート率）は従来どおり通算コホート(sr)基準、売上・単価も従来どおり（対象外）。
  const sumR = (sel: (r: (typeof results)[number]) => number) => results.reduce((s, r) => s + sel(r), 0);
  const segSum = (pick: (r: (typeof results)[number]) => { recs: number; uniq: number }) => ({
    recs: sumR((r) => pick(r).recs),
    uniq: sumR((r) => pick(r).uniq),
  });
  const total = {
    interview: {
      first: summaryMx.interview.first,
      second: summaryMx.interview.second,
      thirdPlus: summaryMx.interview.thirdPlus,
      total: summaryMx.interview.total,
    },
    proposal: { fresh: segSum((r) => r.proposal.fresh), existing: segSum((r) => r.proposal.existing), total: segSum((r) => r.proposal.total) },
    proposalPure: sumR((r) => r.proposalPure),
    entry: { fresh: segSum((r) => r.entry.fresh), existing: segSum((r) => r.entry.existing), total: segSum((r) => r.entry.total) },
    entryPure: sumR((r) => r.entryPure),
    documentPass: sumR((r) => r.documentPass),
    offer: sumR((r) => r.offer),
    decided: sumR((r) => r.decided),
    documentPassRecs: sumR((r) => r.documentPassRecs),
    offerRecs: sumR((r) => r.offerRecs),
    decidedRecs: sumR((r) => r.decidedRecs),
    documentPassRate: rate(sr.dp, sr.cohort),
    offerRate: rate(sr.offer, sr.dp),
    decidedRate: rate(sr.accept, sr.offer),
    decidedRevenue: sumRevenue,
    decidedUnitPrice: sr.accept > 0 ? sumRevenue / sr.accept : null,
  };

  // T-071 ③ 平均列：各月実績の平均（÷6固定。当月含む6ヶ月の月平均）。
  // 率は「平均人数の隣接段比」（cohort 0 の月の null 扱いを単純化、月の実態に近い）。
  const n = results.length;
  const avg = (xs: (number | null | undefined)[]): number =>
    n > 0 ? xs.reduce<number>((s, v) => s + (v ?? 0), 0) / n : 0;
  const avgInterviewFirst = avg(results.map((r) => r.interview.first));
  const avgInterviewSecond = avg(results.map((r) => r.interview.second));
  const avgInterviewThirdPlus = avg(results.map((r) => r.interview.thirdPlus));
  const avgInterviewTotal = avg(results.map((r) => r.interview.total));
  // 提案/エントリーは {recs,uniq} の2軸。recs/uniq を別々に平均する。
  const avgSeg = (sel: (r: (typeof results)[number]) => { recs: number; uniq: number }) => ({
    recs: avg(results.map((r) => sel(r).recs)),
    uniq: avg(results.map((r) => sel(r).uniq)),
  });
  const avgProposalFresh = avgSeg((r) => r.proposal.fresh);
  const avgProposalExisting = avgSeg((r) => r.proposal.existing);
  const avgProposalTotal = avgSeg((r) => r.proposal.total);
  const avgEntryFresh = avgSeg((r) => r.entry.fresh);
  const avgEntryExisting = avgSeg((r) => r.entry.existing);
  const avgEntryTotal = avgSeg((r) => r.entry.total);
  const avgDP = avg(results.map((r) => r.documentPass));
  const avgOffer = avg(results.map((r) => r.offer));
  const avgDecided = avg(results.map((r) => r.decided));
  const avgRevenue = avg(results.map((r) => r.decidedRevenue));
  const avgCohortBase = avg(monthCalcs.map((c) => c.cohortBase));
  const average = {
    interview: { first: avgInterviewFirst, second: avgInterviewSecond, thirdPlus: avgInterviewThirdPlus, total: avgInterviewTotal },
    proposal: { fresh: avgProposalFresh, existing: avgProposalExisting, total: avgProposalTotal },
    proposalPure: avg(results.map((r) => r.proposalPure)),
    entry: { fresh: avgEntryFresh, existing: avgEntryExisting, total: avgEntryTotal },
    entryPure: avg(results.map((r) => r.entryPure)),
    documentPass: avgDP,
    offer: avgOffer,
    decided: avgDecided,
    documentPassRecs: avg(results.map((r) => r.documentPassRecs)),
    offerRecs: avg(results.map((r) => r.offerRecs)),
    decidedRecs: avg(results.map((r) => r.decidedRecs)),
    documentPassRate: rate(avgDP, avgCohortBase),
    offerRate: rate(avgOffer, avgDP),
    decidedRate: rate(avgDecided, avgOffer),
    decidedRevenue: avgRevenue,
    decidedUnitPrice: avgDecided > 0 ? avgRevenue / avgDecided : null,
  };

  return NextResponse.json({
    employee: { id: employee.id, name: employee.name },
    months,
    cohorts: results,
    total,
    average,
  });
}
