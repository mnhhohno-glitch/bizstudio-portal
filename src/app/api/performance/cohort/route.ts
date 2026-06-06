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

  const results = await Promise.all(
    targetMonths.map(async (ym) => {
      const mStart = monthStartTs(ym);
      const mEnd = nextMonthStartTs(ym); // 排他

      // コホート＝その月に entryDate を持つ候補者（post-app・担当軸・archived除く）。
      // その候補者集合について、documentPassDate/offerDate/acceptanceDate を「いつか」持つか（月窓に縛らない）を追跡。
      const rows = await prisma.$queryRawUnsafe<
        { cohort: number; dp: number; offer: number; accept: number }[]
      >(`
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
        FROM progressed;`);

      const r = rows[0] ?? { cohort: 0, dp: 0, offer: 0, accept: 0 };
      return {
        yearMonth: ym,
        entry: r.cohort, // コホート人数（その月エントリー人数）
        documentPass: r.dp,
        offer: r.offer,
        acceptance: r.accept,
        // コホート隣接段階基準の率
        documentPassRate: rate(r.dp, r.cohort),
        offerRate: rate(r.offer, r.dp),
        acceptanceRate: rate(r.accept, r.offer),
      };
    }),
  );

  return NextResponse.json({
    employee: { id: employee.id, name: employee.name },
    months,
    cohorts: results,
  });
}
