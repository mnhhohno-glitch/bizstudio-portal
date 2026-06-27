// T-071 実績表マトリクス API（粒度 day/week/month 対応）。
// 起算日(anchorDate)を起点に、粒度に応じた列（日5/週5/月6）の実績＋目標＋TOTAL＋達成率を返す。
//
// 実績は computeWeeklyMatrix（weeklyMatrix.ts、raw SQL）を各列レンジで呼ぶ（数え方は変更しない）。
// TOTAL は列別合計ではなく「全列をカバーする全期間」で再集計（候補者ユニーク重複を排除）。
// 目標（粒度別）：
//   - week  ：起算月の月目標を 5 週営業日按分（allocateToWeeks）。TOTAL 目標＝月目標。
//   - day   ：起算月の月目標 ÷ 月営業日数 を「営業日の列」に配分（土日祝列は 0）。TOTAL＝列合計。
//   - month ：各列の月の登録目標をそのまま。未登録は null。TOTAL＝登録分の合計。
// 後方互換：granularity 未指定は week。
// エンドポイント名は weekly のまま（呼び出しは PerformancePanel のみ）。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { computeWeeklyMatrix, computeInterviewRankBreakdown, applyAdditiveTotals, type WeeklyMatrix } from "@/lib/performance/weeklyMatrix";
import { buildColumns, type Granularity } from "@/lib/performance/columns";
import { allocateToWeeks, monthBusinessDays, type WeekBucket } from "@/lib/performance/businessDays";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type TKey = "interviewTotal" | "interviewFirst" | "interviewExisting" | "proposalUniq" | "entryUniq" | "documentPass" | "offer" | "acceptance" | "unitPrice";
const TKEYS: TKey[] = ["interviewTotal", "interviewFirst", "interviewExisting", "proposalUniq", "entryUniq", "documentPass", "offer", "acceptance", "unitPrice"];
// 週按分する対象（面談各行・紹介・エントリーのみ。書類通過以降・粗利単価は週按分しない＝週列では目標を出さない）。
const WEEK_ALLOCATED: Record<TKey, boolean> = {
  interviewTotal: true, interviewFirst: true, interviewExisting: true, proposalUniq: true, entryUniq: true,
  documentPass: false, offer: false, acceptance: false, unitPrice: false,
};

// PerformanceTarget 行 → 段階の目標値。interviewTotal=初回+既存、unitPrice=単価。未設定は null。
type TargetRowLike = {
  interviewCount: number; existingInterviewCount: number | null; introductionCount: number; entryCount: number;
  documentPassCount: number; offerCount: number; acceptanceCount: number; unitPrice: number;
};
function targetValueOf(t: TargetRowLike, key: TKey): number | null {
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
}

function actualOf(m: WeeklyMatrix, key: TKey): number {
  switch (key) {
    case "interviewTotal": return m.interview.total;
    case "interviewFirst": return m.interview.first;
    case "interviewExisting": return m.interview.thirdPlus;
    case "proposalUniq": return m.proposal.total.uniq;
    case "entryUniq": return m.entry.total.uniq;
    case "documentPass": return m.selection.documentPass;
    case "offer": return m.selection.offer;
    case "acceptance": return m.selection.acceptance;
    case "unitPrice": return m.selection.decidedUnitPrice ?? 0;
  }
}
function rate(num: number, den: number | null): number | null {
  if (den == null || den <= 0) return null;
  return num / den;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employeeId");
  const anchorDate = searchParams.get("anchorDate");
  const gParam = searchParams.get("granularity");
  const granularity: Granularity = gParam === "day" || gParam === "month" ? gParam : "week";

  if (!employeeId || !anchorDate || !DATE_RE.test(anchorDate)) {
    return NextResponse.json({ error: "employeeId と anchorDate(YYYY-MM-DD) が必要です" }, { status: 400 });
  }

  // 全員（全CA合算）モード
  const allCas = employeeId === "all";
  let resolvedEmployeeId = "__nonexistent__";
  let employeeName = "全員";
  let userId = "__nonexistent__";
  if (!allCas) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true, userId: true },
    });
    if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });
    resolvedEmployeeId = employee.id;
    employeeName = employee.name;
    userId = employee.userId ?? "__nonexistent__";
  }

  const columns = buildColumns(granularity, anchorDate);
  const anchorMonth = anchorDate.slice(0, 7);

  // 各列の実績＋TOTAL（全列カバー範囲で再集計）＋面談ランク割合（円グラフ用・TOTAL範囲）を並列
  // 新規/既存(scoped)は表示期間全体でランク付けする（各週=cell, ランク窓=全列カバー範囲）→ Σ週=合計。
  const rankWindow = { from: columns[0].from, to: columns[columns.length - 1].to };
  const [columnMatrices, totalMatrix, interviewRanks] = await Promise.all([
    Promise.all(columns.map((c) => computeWeeklyMatrix({ employeeId: resolvedEmployeeId, userId, from: c.from, to: c.to, allCas, rankWindow }))),
    computeWeeklyMatrix({ employeeId: resolvedEmployeeId, userId, from: columns[0].from, to: columns[columns.length - 1].to, allCas, rankWindow }),
    computeInterviewRankBreakdown({ employeeId: resolvedEmployeeId, from: columns[0].from, to: columns[columns.length - 1].to, allCas }),
  ]);
  // 合計列の人数・件数（提案/エントリー/選考）を各週の合算に置換（DISTINCT 再集計をやめ縦横一致させる）。
  applyAdditiveTotals(totalMatrix, columnMatrices);

  // 目標：全員モードは目標なし。個別のみ対象月の PerformanceTarget をまとめて取得。
  const neededMonths = Array.from(new Set([anchorMonth, ...columns.map((c) => c.yearMonth)]));
  const targetRows = allCas ? [] : await prisma.performanceTarget.findMany({
    where: { employeeId: resolvedEmployeeId, yearMonth: { in: neededMonths } },
  });
  const targetByMonth = new Map(targetRows.map((t) => [t.yearMonth, t]));
  const targetExists = allCas ? false : (granularity === "month")
    ? columns.some((c) => targetByMonth.has(c.yearMonth))
    : targetByMonth.has(anchorMonth);

  // 粒度別の目標算出
  function targetVal(ym: string, key: TKey): number | null {
    const t = targetByMonth.get(ym);
    return t ? targetValueOf(t as unknown as TargetRowLike, key) : null;
  }

  // perColumnTargets[key] = 各列の目標、totalTargets[key] = TOTAL目標
  const perColumnTargets: Record<TKey, (number | null)[]> = {} as Record<TKey, (number | null)[]>;
  const totalTargets: Record<TKey, number | null> = {} as Record<TKey, number | null>;

  for (const key of TKEYS) {
    if (granularity === "week") {
      const monthT = targetVal(anchorMonth, key);
      // 週按分しない行（書類通過/内定/承諾/粗利単価）は週列に目標を出さない（合計のみ）。
      if (monthT == null || !WEEK_ALLOCATED[key]) {
        perColumnTargets[key] = columns.map(() => null);
      } else {
        const buckets: WeekBucket[] = columns.map((c) => ({ weekIndex: c.index, startDate: c.fromDateStr, endDate: c.toDateStr, businessDays: c.businessDays }));
        perColumnTargets[key] = allocateToWeeks(monthT, buckets);
      }
      totalTargets[key] = monthT;
    } else if (granularity === "day") {
      const monthT = targetVal(anchorMonth, key);
      if (monthT == null || !WEEK_ALLOCATED[key]) {
        perColumnTargets[key] = columns.map(() => null);
        totalTargets[key] = monthT;
      } else {
        const mBiz = monthBusinessDays(anchorMonth);
        const perDay = mBiz > 0 ? monthT / mBiz : null;
        perColumnTargets[key] = columns.map((c) => (perDay == null ? null : c.businessDays > 0 ? perDay : 0));
        totalTargets[key] = perDay == null ? null : perColumnTargets[key].reduce((s: number, v) => s + (v ?? 0), 0);
      }
    } else {
      // month：各列の月の登録目標をそのまま。TOTAL は登録分の合計（単価は非加算のため合計は出さない）。
      const vals = columns.map((c) => targetVal(c.yearMonth, key));
      perColumnTargets[key] = vals;
      const present = vals.filter((v): v is number => v != null);
      totalTargets[key] = key === "unitPrice" ? null : present.length > 0 ? present.reduce((s, v) => s + v, 0) : null;
    }
  }

  const columnsOut = columns.map((c, i) => {
    const targets: Record<TKey, number | null> = {} as Record<TKey, number | null>;
    for (const key of TKEYS) targets[key] = perColumnTargets[key][i];
    return {
      index: c.index,
      label: c.label,
      subLabel: c.subLabel,
      from: c.fromDateStr,
      to: c.toDateStr,
      businessDays: c.businessDays,
      matrix: columnMatrices[i],
      targets,
    };
  });

  const achievement: Record<TKey, number | null> = {} as Record<TKey, number | null>;
  for (const key of TKEYS) achievement[key] = rate(actualOf(totalMatrix, key), totalTargets[key]);

  return NextResponse.json({
    employee: { id: allCas ? "all" : resolvedEmployeeId, name: employeeName },
    anchorDate,
    granularity,
    targetExists,
    columns: columnsOut,
    total: {
      from: columns[0].fromDateStr,
      to: columns[columns.length - 1].toDateStr,
      matrix: totalMatrix,
      targets: totalTargets,
      achievement,
      interviewRanks, // 面談ランク割合（円グラフ用）。合計＝合計面談数。
    },
  });
}
