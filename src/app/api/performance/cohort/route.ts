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

  // 各月の userId 解決（全員は不要）。個別は employee の userId が要る（求人紹介＝User.id 軸）。
  let userId = "__nonexistent__";
  if (!allCas) {
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { userId: true } });
    userId = emp?.userId ?? "__nonexistent__";
  }

  const results = await Promise.all(
    targetMonths.map(async (ym) => {
      const mStart = monthStartTs(ym);
      const mEnd = nextMonthStartTs(ym); // 排他
      const from = new Date(`${ym}-01T00:00:00+09:00`);
      const to = new Date(new Date(`${shiftMonth(ym, 1)}-01T00:00:00+09:00`).getTime() - 1);

      // コホート funnel（書類通過/内定/決定）＋ 月別マトリクス（面談/提案/エントリー人数・売上）を並列。
      const [funnelRows, mx] = await Promise.all([
        // コホート＝その月に entryDate を持つ候補者。後段階を月窓に縛らず追跡。
        prisma.$queryRawUnsafe<{ cohort: number; dp: number; offer: number; accept: number }[]>(`
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
          )
          SELECT
            (SELECT COUNT(*) FROM cohort)::int cohort,
            COUNT(*) FILTER (WHERE has_dp)::int dp,
            COUNT(*) FILTER (WHERE has_offer)::int offer,
            COUNT(*) FILTER (WHERE has_accept)::int accept
          FROM progressed;`),
        computeWeeklyMatrix({ employeeId, userId, from, to, allCas }),
      ]);

      const r = funnelRows[0] ?? { cohort: 0, dp: 0, offer: 0, accept: 0 };
      return {
        yearMonth: ym,
        // 面談（月別人数・record）。%（構成比）は UI で ÷合計面談。
        interview: { first: mx.interview.first, second: mx.interview.second, thirdPlus: mx.interview.thirdPlus, total: mx.interview.total },
        // 求人紹介（月別 人数・候補者ユニーク）。% は UI で ÷合計提案。
        proposal: { fresh: mx.proposal.fresh.uniq, existing: mx.proposal.existing.uniq, total: mx.proposal.total.uniq },
        // エントリー（月別 人数）。total = コホート基（その月エントリー人数）。% は UI で ÷合計エントリー。
        entry: { fresh: mx.entry.fresh.uniq, existing: mx.entry.existing.uniq, total: mx.entry.total.uniq },
        // 選考（コホート隣接段階基準・前段が分母）
        documentPass: r.dp,
        offer: r.offer,
        decided: r.accept, // 決定数＝内定承諾
        documentPassRate: rate(r.dp, r.cohort), // ÷コホートエントリー
        offerRate: rate(r.offer, r.dp), // ÷書類通過
        decidedRate: rate(r.accept, r.offer), // ÷内定
        // 決定売上・売上単価（月窓の revenue 集計。%は出さない）
        decidedRevenue: mx.selection.decidedRevenue,
        decidedUnitPrice: mx.selection.decidedUnitPrice,
      };
    }),
  );

  return NextResponse.json({
    employee: { id: employee.id, name: employee.name },
    months,
    cohorts: results,
  });
}
