// T-190: AI（Claude / ChatGPT）向け 経営数値 読み取り専用 API。
//
// GET /api/ai/company-kpi?year=YYYY&month=YYYY-MM
//   - 完全読み取り専用。INSERT/UPDATE/DELETE は一切行わない（GET 以外も export しない）。
//   - 個人情報は返さない。求職者・企業・求人の明細は含めず、CA は employeeNumber と name のみ。
//   - 人数系・決定売上は実績表の正本 computeWeeklyMatrix を任意レンジで呼んで取る
//     （数字が実績表と一致することが最重要なので、集計ロジックを二重実装しない）。
//   - 企業面接数と請求売上（税抜）だけ実績表に無いため src/lib/aiRead/kpi.ts で同じ述語で別集計する。
//   - CA売上のみを扱う（RA売上・シェアリング・業務委託売上は Portal 管理外）。scope: "CA_ONLY" で明示する。
//   - JST 境界は src/lib/dailyReport/jstDate.ts のヘルパを使う（罠 #17：toISOString().slice(0,10) 禁止）。

import { prisma } from "@/lib/prisma";
import { assertAiReadAuth } from "@/lib/aiRead/auth";
import { countCompanyInterviewCandidates, sumInvoiceRevenue } from "@/lib/aiRead/kpi";
import { computeWeeklyMatrix } from "@/lib/performance/weeklyMatrix";
import { todayJstDateString, jstDateStart, jstDateEnd } from "@/lib/dailyReport/jstDate";

export const dynamic = "force-dynamic";

// 氏名を返すかどうかの切り替え（1か所）。false にすると byCa は employeeNumber のみになる。
const INCLUDE_CA_NAME = true;

const YEAR_RE = /^\d{4}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

const NO_STORE = { "Cache-Control": "no-store" } as const;

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400, headers: NO_STORE });
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 対象年のレンジ。当年なら 1/1〜today、それ以外は 1/1〜12/31。 */
function yearRange(year: string, today: string): { from: string; to: string } {
  const curYear = today.slice(0, 4);
  return { from: `${year}-01-01`, to: year === curYear ? today : `${year}-12-31` };
}

/** 対象月のレンジ。当月なら 1日〜today、それ以外は 1日〜月末（翌月1日の前日で算出）。 */
function monthRange(yyyyMm: string, today: string): { from: string; to: string } {
  const curMonth = today.slice(0, 7);
  if (yyyyMm === curMonth) return { from: `${yyyyMm}-01`, to: today };
  const [y, m] = yyyyMm.split("-").map((s) => parseInt(s, 10));
  const lastDay = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) - 24 * 60 * 60 * 1000);
  return {
    from: `${yyyyMm}-01`,
    to: `${lastDay.getUTCFullYear()}-${pad2(lastDay.getUTCMonth() + 1)}-${pad2(lastDay.getUTCDate())}`,
  };
}

/** year レンジに対応する yearMonth（"YYYY-01"〜"YYYY-12"）一覧。 */
function monthsOfYear(year: string): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${pad2(i + 1)}`);
}

interface Block {
  // 請求売上（税抜）と粗利は別物。AI に渡したとき「売上」と誤読されないようキーを分ける。
  invoiceRevenue: number;
  grossProfit: number;
  revenueTarget: number;
  caInterviewCount: number;
  companyInterviewCount: number | null;
  entryCount: number;
  documentPassCount: number;
  offerCount: number;
  // 成約「件数」（JobEntry 行数）と決定「人数」（求職者ユニーク）も別物。
  // 同一求職者が複数社で承諾すると件数 > 人数になる（例: 2026-08 は 10 件 / 9 人）。
  decidedDealCount: number;
  decidedCandidateCount: number;
  averageInvoiceUnitPrice: number | null;
  averageGrossUnitPrice: number | null;
}

/** 1 レンジ分の実績を実績表と同じ定義で組み立てる。 */
async function buildBlock(params: {
  employeeId: string;
  userId: string;
  range: { from: string; to: string };
  allCas: boolean;
  revenueTarget: number;
}): Promise<Block> {
  const from = jstDateStart(params.range.from);
  const to = jstDateEnd(params.range.to);
  const [matrix, companyInterviewCount, invoiceRevenue] = await Promise.all([
    computeWeeklyMatrix({ employeeId: params.employeeId, userId: params.userId, from, to, allCas: params.allCas }),
    countCompanyInterviewCandidates({ employeeId: params.employeeId, from, to, allCas: params.allCas }),
    // 請求売上だけ実績表に露出していないため同一述語で別集計（src/lib/aiRead/kpi.ts）。
    sumInvoiceRevenue({ employeeId: params.employeeId, from, to, allCas: params.allCas }),
  ]);
  // decidedRevenue は実績表の「決定粗利」。売上0のレンジでは null になるので 0 に寄せる。
  const grossProfit = matrix.selection.decidedRevenue ?? 0;
  // 件数＝acceptanceRecs（承諾行数）、人数＝acceptance（求職者ユニーク）。どちらも実績表の正本の値をそのまま使う。
  const decidedDealCount = matrix.selection.acceptanceRecs;
  return {
    invoiceRevenue,
    grossProfit,
    revenueTarget: params.revenueTarget,
    caInterviewCount: matrix.interview.total,
    companyInterviewCount,
    entryCount: matrix.entry.total.uniq,
    documentPassCount: matrix.selection.documentPass,
    offerCount: matrix.selection.offer,
    decidedDealCount,
    decidedCandidateCount: matrix.selection.acceptance,
    averageInvoiceUnitPrice: decidedDealCount > 0 ? invoiceRevenue / decidedDealCount : null,
    averageGrossUnitPrice: decidedDealCount > 0 ? grossProfit / decidedDealCount : null,
  };
}

export async function GET(req: Request) {
  const deny = assertAiReadAuth(req);
  if (deny) return deny;

  const { searchParams } = new URL(req.url);
  const yearParam = searchParams.get("year");
  const monthParam = searchParams.get("month");
  if (yearParam !== null && !YEAR_RE.test(yearParam)) return bad("year は YYYY 形式で指定してください");
  if (monthParam !== null && !MONTH_RE.test(monthParam)) return bad("month は YYYY-MM 形式で指定してください");
  if (monthParam !== null) {
    const mm = parseInt(monthParam.slice(5, 7), 10);
    if (mm < 1 || mm > 12) return bad("month は YYYY-MM 形式で指定してください");
  }

  const today = todayJstDateString();
  const year = yearParam ?? today.slice(0, 4);
  const month = monthParam ?? today.slice(0, 7);
  const yRange = yearRange(year, today);
  const mRange = monthRange(month, today);

  // CA 一覧は実績表の担当セレクト（/api/performance/advisors）と同条件：jobCategory='CA' かつ在籍。
  const cas = await prisma.employee.findMany({
    where: { jobCategory: "CA", status: "active" },
    select: { id: true, employeeNumber: true, name: true, userId: true },
    orderBy: { employeeNumber: "asc" },
  });
  const caIds = cas.map((c) => c.id);

  // 目標：PerformanceTarget.targetRevenue（在籍CA分のみ）。year は 12 か月分、month は該当月。
  const yearMonths = monthsOfYear(year);
  const targets = caIds.length
    ? await prisma.performanceTarget.findMany({
        where: { employeeId: { in: caIds }, yearMonth: { in: Array.from(new Set([...yearMonths, month])) } },
        select: { employeeId: true, yearMonth: true, targetRevenue: true },
      })
    : [];
  const inYear = (ym: string) => ym.slice(0, 4) === year;
  const sumTarget = (rows: typeof targets) => rows.reduce((s, t) => s + t.targetRevenue, 0);
  const yearTargetAll = sumTarget(targets.filter((t) => inYear(t.yearMonth)));
  const monthTargetAll = sumTarget(targets.filter((t) => t.yearMonth === month));
  const targetRegisteredMonths = new Set(targets.filter((t) => inYear(t.yearMonth)).map((t) => t.yearMonth)).size;
  const targetByCa = (employeeId: string, pred: (ym: string) => boolean) =>
    sumTarget(targets.filter((t) => t.employeeId === employeeId && pred(t.yearMonth)));

  // 全社（全CA合算）。allCas=true では employeeId は使われないためダミーを渡す（weekly route と同じ）。
  const ALL = "__nonexistent__";
  const [yearAll, monthAll] = await Promise.all([
    buildBlock({ employeeId: ALL, userId: ALL, range: yRange, allCas: true, revenueTarget: yearTargetAll }),
    buildBlock({ employeeId: ALL, userId: ALL, range: mRange, allCas: true, revenueTarget: monthTargetAll }),
  ]);

  // CA 別（employeeNumber 昇順）。CA ごとに year/month の 2 レンジ。
  const byCa: Array<{ employeeNumber: string; name?: string; year: Block; month: Block }> = [];
  for (const ca of cas) {
    const userId = ca.userId ?? "__nonexistent__";
    const [y, m] = await Promise.all([
      buildBlock({ employeeId: ca.id, userId, range: yRange, allCas: false, revenueTarget: targetByCa(ca.id, inYear) }),
      buildBlock({ employeeId: ca.id, userId, range: mRange, allCas: false, revenueTarget: targetByCa(ca.id, (ym) => ym === month) }),
    ]);
    byCa.push({
      employeeNumber: ca.employeeNumber,
      ...(INCLUDE_CA_NAME ? { name: ca.name } : {}),
      year: y,
      month: m,
    });
  }

  return Response.json(
    {
      asOf: today,
      timezone: "Asia/Tokyo",
      scope: "CA_ONLY",
      scopeNote:
        "この数値は Portal に登録された CA実績（人材紹介のCA売上）のみです。RA売上・JOBシェアリング・業務委託売上は Portal 管理外のため含まれません。会社全体の売上ではありません。",
      definitions: {
        invoiceRevenue:
          "請求売上（税抜）。JobEntry の acceptanceDate（承諾日）が期間内の行について SUM(revenue)。控除前の金額",
        grossProfit:
          "粗利。同じ母集団について SUM(revenue - jobDbCost - cost)＝請求売上 − 求人DB費 − 仕入。実績表の「決定粗利」と同一（computeWeeklyMatrix.selection.decidedRevenue）",
        decidedDealCount:
          "成約件数。acceptanceDate が期間内の JobEntry の行数（社数）。同一求職者が複数社で承諾すると decidedCandidateCount より大きくなる",
        decidedCandidateCount:
          "決定人数。acceptanceDate が期間内の JobEntry の求職者ユニーク人数。実績表の「承諾（人数）」と同一",
        counts:
          "件数系・人数系はいずれも computeWeeklyMatrix と同一定義。担当軸は Candidate.employeeId、JobEntry は archivedAt 除外",
        revenueTarget:
          "**粗利ベースの目標**（画面上の「目標粗利」）。PerformanceTarget.targetRevenue の合計（在籍CAのみ）。比較対象は grossProfit であり invoiceRevenue ではない。year は yearMonth が YYYY-01〜YYYY-12、month は該当 yearMonth。未登録月は 0",
        caInterviewCount:
          "CAと求職者の面談（InterviewRecord）の件数。辞退系 resultFlag を除外する実績表と同一ルール",
        companyInterviewCount:
          "企業との面接。JobEntry の firstInterviewDate / secondInterviewDate / finalInterviewDate のいずれかが期間内にある求職者のユニーク人数（同一人の複数社・複数段階は 1 人）",
        averageInvoiceUnitPrice: "invoiceRevenue ÷ decidedDealCount。decidedDealCount が 0 のときは null",
        averageGrossUnitPrice: "grossProfit ÷ decidedDealCount。decidedDealCount が 0 のときは null",
      },
      caCount: cas.length,
      year: {
        period: { from: yRange.from, to: yRange.to },
        ...yearAll,
        targetRegisteredMonths,
      },
      month: { period: { from: mRange.from, to: mRange.to }, ...monthAll },
      byCa,
    },
    { headers: NO_STORE },
  );
}
