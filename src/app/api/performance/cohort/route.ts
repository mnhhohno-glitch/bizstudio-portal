// T-071 直近6ヶ月 API（発生月ベース）。
// 各段階を「その月に発生した数」で数え、当月/月次タブ（weeklyMatrix）と同一の日付軸に揃える。
//   - 書類通過＝その月に document_pass_date がある人数/件数
//   - 内定＝その月に offer_date がある人数/件数
//   - 決定＝その月に acceptance_date がある人数/件数（決定粗利・単価も同じ acceptance_date 軸）
//   - %は段階間比率（書類通過÷合計エントリー人数／内定÷書類通過／決定÷内定）＝当月タブと同一。
//   - 提案/エントリーは scoped（その暦月の1件目/2件目以降・人数(件数)）。合計列の人数だけ通算 DISTINCT。
// 対象：6ヶ月前〜前月（当月は含まない）。JST 基準。computeWeeklyMatrix を6ヶ月分回す。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { todayJstDateString } from "@/lib/dailyReport/jstDate";
import { computeWeeklyMatrix } from "@/lib/performance/weeklyMatrix";
import { aggregateAllCaTargets } from "@/lib/performance/aggregateTargets";

function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map((s) => parseInt(s, 10));
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
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

  // 当月を含まない：前月（-1）から months ヶ月分さかのぼる。
  const thisMonth = todayJstDateString().slice(0, 7);
  const targetMonths: string[] = [];
  for (let i = months; i >= 1; i--) targetMonths.push(shiftMonth(thisMonth, -i));

  // 新規/既存(scoped)は「その暦月(JST)の1件目=新規 / 2件目以降=既存」で判定する（weeklyMatrix 側で完結・月列とそのまま一致）。

  // 各月の userId 解決（全員は不要）。個別は employee の userId が要る（求人紹介＝User.id 軸）。
  let userId = "__nonexistent__";
  if (!allCas) {
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { userId: true } });
    userId = emp?.userId ?? "__nonexistent__";
  }

  // 目標（各月の PerformanceTarget・月目標）。当月/月次タブと同一マッピング。全員モードは目標なし。
  type TKey = "interviewTotal" | "interviewFirst" | "interviewExisting" | "proposalUniq" | "entryUniq" | "documentPass" | "offer" | "acceptance" | "unitPrice";
  const TKEYS: TKey[] = ["interviewTotal", "interviewFirst", "interviewExisting", "proposalUniq", "entryUniq", "documentPass", "offer", "acceptance", "unitPrice"];
  type TgtRow = { interviewCount: number; existingInterviewCount: number | null; introductionCount: number; entryCount: number; documentPassCount: number; offerCount: number; acceptanceCount: number; unitPrice: number };
  const targetValueOf = (t: TgtRow, key: TKey): number | null => {
    switch (key) {
      case "interviewTotal": return (t.interviewCount ?? 0) + (t.existingInterviewCount ?? 0);
      case "interviewFirst": return t.interviewCount;
      case "interviewExisting": return t.existingInterviewCount;
      case "proposalUniq": return t.introductionCount;
      case "entryUniq": return t.entryCount;
      case "documentPass": return t.documentPassCount;
      case "offer": return t.offerCount;
      case "acceptance": return t.acceptanceCount;
      case "unitPrice": return t.unitPrice;
    }
  };
  const targetByMonth = allCas
    ? await aggregateAllCaTargets(targetMonths)
    : new Map((await prisma.performanceTarget.findMany({ where: { employeeId, yearMonth: { in: targetMonths } } })).map((t) => [t.yearMonth, t] as const));
  const buildTargets = (ym: string): Record<TKey, number | null> => {
    const t = targetByMonth.get(ym);
    const o = {} as Record<TKey, number | null>;
    for (const k of TKEYS) o[k] = t ? targetValueOf(t as unknown as TgtRow, k) : null;
    return o;
  };

  // 各月 result（発生月ベース＝当月/月次タブと同一の computeWeeklyMatrix を6ヶ月分回す）。
  const results = await Promise.all(
    targetMonths.map(async (ym) => {
      const from = new Date(`${ym}-01T00:00:00+09:00`);
      const to = new Date(new Date(`${shiftMonth(ym, 1)}-01T00:00:00+09:00`).getTime() - 1);
      const mx = await computeWeeklyMatrix({ employeeId, userId, from, to, allCas });

      // 選考＝発生月ベース（document_pass_date / offer_date / acceptance_date がその月）。当月/月次タブと同一軸。
      const dp = mx.selection.documentPass;
      const offer = mx.selection.offer;
      const decided = mx.selection.acceptance;
      const entryUniq = mx.entry.scoped.total.uniq; // 合計エントリー人数（書類通過率の分母）
      return {
        yearMonth: ym,
        // 面談（月別人数・record）。%（構成比）は UI で ÷合計面談。
        interview: { first: mx.interview.first, second: mx.interview.second, thirdPlus: mx.interview.thirdPlus, total: mx.interview.total },
        // 求人紹介（その暦月の1件目/2件目以降・人数(件数)=scoped）。% は UI で ÷合計提案。
        proposal: { fresh: mx.proposal.scoped.fresh, existing: mx.proposal.scoped.existing, total: mx.proposal.scoped.total },
        // エントリー（その暦月の1件目/2件目以降・人数(件数)=scoped）。% は UI で ÷合計エントリー。
        entry: { fresh: mx.entry.scoped.fresh, existing: mx.entry.scoped.existing, total: mx.entry.scoped.total },
        documentPass: dp,
        offer,
        decided,
        documentPassRecs: mx.selection.documentPassRecs,
        offerRecs: mx.selection.offerRecs,
        decidedRecs: mx.selection.acceptanceRecs,
        // %は段階間比率（当月タブと同一）：書類通過÷合計エントリー人数 / 内定÷書類通過 / 決定÷内定。
        documentPassRate: rate(dp, entryUniq),
        offerRate: rate(offer, dp),
        decidedRate: rate(decided, offer),
        // 決定売上・売上単価（その月に acceptance_date がある粗利・単価）。決定数と同一 acceptance_date 軸。
        decidedRevenue: mx.selection.decidedRevenue,
        decidedUnitPrice: mx.selection.decidedUnitPrice,
        // その月の目標（月目標）。
        targets: buildTargets(ym),
      };
    }),
  );

  // 合計・平均の目標：件数系は present 月の合算/平均、単価は present 月の平均。
  const totalTargets = {} as Record<TKey, number | null>;
  const avgTargets = {} as Record<TKey, number | null>;
  for (const k of TKEYS) {
    const vals = results.map((r) => r.targets[k]).filter((v): v is number => v != null);
    const sum = vals.reduce((s, v) => s + v, 0);
    totalTargets[k] = vals.length === 0 ? null : k === "unitPrice" ? sum / vals.length : sum;
    avgTargets[k] = vals.length === 0 ? null : sum / vals.length;
  }

  // 合計列：件数は各月の合算（縦横一致）。人数は通算 mx の DISTINCT（6ヶ月にまたがって出た人を二重計上しない）。
  const summaryRange = {
    from: new Date(`${targetMonths[0]}-01T00:00:00+09:00`),
    to: new Date(new Date(`${shiftMonth(targetMonths[targetMonths.length - 1], 1)}-01T00:00:00+09:00`).getTime() - 1),
  };
  const summaryMx = await computeWeeklyMatrix({ employeeId, userId, from: summaryRange.from, to: summaryRange.to, allCas });
  // 売上は月の加算（決定売上＝粗利は単純合計）。売上単価は通算粗利 ÷ 通算決定人数（acceptance_date 軸）。
  const sumRevenue = results.reduce((s, r) => s + (r.decidedRevenue ?? 0), 0);
  const sumR = (sel: (r: (typeof results)[number]) => number) => results.reduce((s, r) => s + sel(r), 0);
  // 件数＝Σ月、人数＝通算 DISTINCT（summaryMx の同じ区分）。実績表の合計列と同じ数え方。
  const seg = (pick: (r: (typeof results)[number]) => { recs: number; uniq: number }, sumUniq: number) => ({
    recs: sumR((r) => pick(r).recs),
    uniq: sumUniq,
  });
  // 段階間比率の分子・分母（合計列・発生月ベースの Σ）。
  const tDP = sumR((r) => r.documentPass);
  const tOffer = sumR((r) => r.offer);
  const tDecided = sumR((r) => r.decided);
  const tEntryUniq = summaryMx.entry.scoped.total.uniq; // 書類通過率の分母＝合計列に表示するエントリー人数と同じ値
  const total = {
    interview: {
      first: summaryMx.interview.first,
      second: summaryMx.interview.second,
      thirdPlus: summaryMx.interview.thirdPlus,
      total: summaryMx.interview.total,
    },
    proposal: {
      fresh: seg((r) => r.proposal.fresh, summaryMx.proposal.scoped.fresh.uniq),
      existing: seg((r) => r.proposal.existing, summaryMx.proposal.scoped.existing.uniq),
      total: seg((r) => r.proposal.total, summaryMx.proposal.scoped.total.uniq),
    },
    entry: {
      fresh: seg((r) => r.entry.fresh, summaryMx.entry.scoped.fresh.uniq),
      existing: seg((r) => r.entry.existing, summaryMx.entry.scoped.existing.uniq),
      total: seg((r) => r.entry.total, tEntryUniq),
    },
    documentPass: tDP,
    offer: tOffer,
    decided: tDecided,
    documentPassRecs: sumR((r) => r.documentPassRecs),
    offerRecs: sumR((r) => r.offerRecs),
    decidedRecs: sumR((r) => r.decidedRecs),
    documentPassRate: rate(tDP, tEntryUniq),
    offerRate: rate(tOffer, tDP),
    decidedRate: rate(tDecided, tOffer),
    decidedRevenue: sumRevenue,
    decidedUnitPrice: tDecided > 0 ? sumRevenue / tDecided : null,
    targets: totalTargets,
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
  const average = {
    interview: { first: avgInterviewFirst, second: avgInterviewSecond, thirdPlus: avgInterviewThirdPlus, total: avgInterviewTotal },
    proposal: { fresh: avgProposalFresh, existing: avgProposalExisting, total: avgProposalTotal },
    entry: { fresh: avgEntryFresh, existing: avgEntryExisting, total: avgEntryTotal },
    documentPass: avgDP,
    offer: avgOffer,
    decided: avgDecided,
    documentPassRecs: avg(results.map((r) => r.documentPassRecs)),
    offerRecs: avg(results.map((r) => r.offerRecs)),
    decidedRecs: avg(results.map((r) => r.decidedRecs)),
    documentPassRate: rate(avgDP, avgEntryTotal.uniq),
    offerRate: rate(avgOffer, avgDP),
    decidedRate: rate(avgDecided, avgOffer),
    decidedRevenue: avgRevenue,
    decidedUnitPrice: avgDecided > 0 ? avgRevenue / avgDecided : null,
    targets: avgTargets,
  };

  return NextResponse.json({
    employee: { id: employee.id, name: employee.name },
    months,
    cohorts: results,
    total,
    average,
  });
}
