// T-073: 目標設定ポップアップ左側の参考値。
// 昨年同月 / 前月 / 直近3か月 / 直近半年 の各段階の実績（数・率）を返す。
// 集計は T-071 確定の computeCaMetricsForRange（担当軸・到達ベース・無効含む・アーカイブ除く）を流用。
// 期間レンジは対象 yearMonth を基準に算出する（実績表の「今日起点」ではなく、目標を立てる月が基準）。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { computeCaMetricsForRange, type CaRangeMetrics } from "@/lib/dailyReport/metrics";
import { computeWeeklyMatrix } from "@/lib/performance/weeklyMatrix";
import { jstMonthRangeStart, jstMonthRangeEnd } from "@/lib/dailyReport/jstDate";

const YYYY_MM = /^\d{4}-(0[1-9]|1[0-2])$/;

// "YYYY-MM" を month 単位で前後に動かす。
function shiftMonth(yearMonth: string, deltaMonths: number): string {
  const [y, m] = yearMonth.split("-").map((s) => parseInt(s, 10));
  const idx = y * 12 + (m - 1) + deltaMonths;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employeeId");
  const yearMonth = searchParams.get("yearMonth");

  if (!employeeId || !yearMonth || !YYYY_MM.test(yearMonth)) {
    return NextResponse.json({ error: "employeeId と yearMonth(YYYY-MM) が必要です" }, { status: 400 });
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, userId: true },
  });
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });
  const userId = employee.userId ?? "__nonexistent__";

  // 参考期間：昨年同月 / 前月 / 直近3か月 / 直近半年（いずれも yearMonth を基準）。
  const lastYearSameMonth = shiftMonth(yearMonth, -12);
  const prevMonth = shiftMonth(yearMonth, -1);
  // 直近3か月＝前月から遡って3か月（yearMonth は未来の目標月なので含めない）。
  const quarterFrom = shiftMonth(yearMonth, -3);
  const halfFrom = shiftMonth(yearMonth, -6);

  const periodDefs: { key: string; fromMonth: string; toMonth: string }[] = [
    { key: "lastYearSameMonth", fromMonth: lastYearSameMonth, toMonth: lastYearSameMonth },
    { key: "prevMonth", fromMonth: prevMonth, toMonth: prevMonth },
    { key: "quarter", fromMonth: quarterFrom, toMonth: prevMonth },
    { key: "half", fromMonth: halfFrom, toMonth: prevMonth },
  ];

  // 参考値の紹介〜承諾は実績表（T-071 computeWeeklyMatrix）と同じ集計に統一する。
  //   - 紹介人数＝両ソース統合の候補者ユニーク人数（proposal.total.uniq）。旧 CandidateFile 単一・件数(jobIntroduced)はやめる。
  //   - 各段階人数も matrix のユニーク人数（面談=initial、エントリー=uniq、書類通過/内定/承諾=候補者ユニーク）。
  //   - 各率は人数ベースの隣接段比（逆算チェーンと一致）：紹介率=紹介÷面談、エントリー率=エントリー÷紹介 …。
  //     これで参考値の率が件数分母による過小値（例 2.8%）にならず、目標へ写しても逆算が膨張しない。
  //   - 初回面談率（実施率＝実施÷予定）は computeCaMetricsForRange の値を維持（隣接段比ではない別指標）。
  //   日報（computeCaMetricsForRange の出力）は不変。ここで参照して参考値を組み替えるだけ。
  const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);
  const results = await Promise.all(
    periodDefs.map(async (d) => {
      const from = jstMonthRangeStart(d.fromMonth);
      const to = jstMonthRangeEnd(d.toMonth);
      const [ca, matrix] = await Promise.all([
        computeCaMetricsForRange({ userId, employeeId: employee.id, from, to }),
        computeWeeklyMatrix({ employeeId: employee.id, userId, from, to }),
      ]);
      const ivFirst = matrix.interview.first; // 初回面談（人数）
      const ivExisting = matrix.interview.second + matrix.interview.thirdPlus; // 既存面談＝求人(2回目)+既存(3回目以降)
      const ivTotal = matrix.interview.total; // 合計面談（first+second+thirdPlus）
      const intro = matrix.proposal.total.uniq; // 紹介（人数・両ソース統合ユニーク）
      const ent = matrix.entry.total.uniq; // エントリー（人数ユニーク）
      const dp = matrix.selection.documentPass;
      const of = matrix.selection.offer;
      const ac = matrix.selection.acceptance;
      // 既存 metrics 形を維持しつつ、紹介〜承諾の人数と率を matrix（人数ベース隣接段比）で差し替える。
      // ⚠️ 紹介率の分母は**合計面談**（実績表・隣接段比と一致）。a1c0321 で初回面談を渡していたバグの修正。
      //    半年など長期間で >100% になるのは過去の面談履歴が未インポートのため。データ投入後に正常化。
      const metrics: CaRangeMetrics = {
        ...ca,
        firstInterviewExecuted: ivFirst, // 実績表と一致（=ca.firstInterviewExecuted）
        // firstInterviewRate（実施率）は ca のまま維持
        jobIntroduced: intro,
        jobIntroductionRate: ratio(intro, ivTotal), // 紹介人数 ÷ 合計面談（面談→紹介・人数ベース隣接段比）
        entry: { count: ent, denominator: intro, rate: ratio(ent, intro) },
        documentPass: { count: dp, denominator: ent, rate: ratio(dp, ent) },
        offer: { count: of, denominator: dp, rate: ratio(of, dp) },
        acceptance: { count: ac, denominator: of, rate: ratio(ac, of) },
      };
      const proposalPerPerson = matrix.proposal.total.perPerson;
      // 決定単価（売上単価）の実績＝決定売上÷決定数（matrix.selection.decidedUnitPrice）。売上未記録期間は null。
      const decidedUnitPrice = matrix.selection.decidedUnitPrice;
      // 面談の人数（TargetModal は初回/既存/合計の3行＋構成比で表示）。
      return [d.key, { fromMonth: d.fromMonth, toMonth: d.toMonth, metrics, proposalPerPerson, interviewExisting: ivExisting, interviewTotal: ivTotal, decidedUnitPrice }] as [
        string,
        { fromMonth: string; toMonth: string; metrics: CaRangeMetrics; proposalPerPerson: number | null; interviewExisting: number; interviewTotal: number; decidedUnitPrice: number | null },
      ];
    }),
  );

  const reference: Record<string, { fromMonth: string; toMonth: string; metrics: CaRangeMetrics; proposalPerPerson: number | null; interviewExisting: number; interviewTotal: number; decidedUnitPrice: number | null }> = {};
  for (const [k, v] of results) reference[k] = v;

  return NextResponse.json({
    employee: { id: employee.id, name: employee.name },
    yearMonth,
    reference,
  });
}
