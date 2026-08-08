import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { jstStringToDbDate, addDaysYmd, nowJstYmd, dbDateToJstYmd } from "@/lib/rpa-scout/jst";
import {
  UNCLASSIFIED,
  SEARCH_COUNT_DROP_THRESHOLD,
  areaAxisLabel,
  sendStatusAxisLabel,
  registAxisLabel,
  gradYearAxisLabel,
  companyCountAxisLabel,
  type AxisEntry,
  type DashboardData,
  type ContinuousUseAlert,
  type SearchDropAlert,
} from "@/lib/rpa-scout/dashboard";

type LastUsedRow = { key: string; recordedAt: Date; machineNo: number };

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// JST壁時計値のDate（UTC欄に保持）→ APIレスポンス用文字列 "YYYY-MM-DDTHH:mm:ss.000Z"
// NextResponse.json のDate自動シリアライズと同一表現（壁時計を保ったまま流れる）
const toWire = (d: Date) => d.toISOString();

// 配信条件ダッシュボード集計。1リクエストで全カード分を返す（固定6クエリ・N+1なし）
export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  if (!YMD_RE.test(from) || !YMD_RE.test(to) || from > to)
    return NextResponse.json({ error: "期間の指定が不正です" }, { status: 400 });

  const machineParam = sp.get("machine");
  const machineNo = machineParam ? parseInt(machineParam, 10) : null;
  if (machineNo != null && (!Number.isFinite(machineNo) || machineNo < 1 || machineNo > 6))
    return NextResponse.json({ error: "号機の指定が不正です" }, { status: 400 });

  // 直前の同じ長さの期間（前期間比用）
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const prevTo = addDaysYmd(from, -1);
  const prevFrom = addDaysYmd(from, -days);

  const whereMachine = machineNo != null ? { machineNo } : {};

  const [logs, prevAgg, patterns, lastByIdRows, lastByNameRows, machines] = await Promise.all([
    // 期間内ログ（recordedAt はJST壁時計値。境界もJST文字列のまま。罠#17）
    prisma.rpaScoutLog.findMany({
      where: {
        ...whereMachine,
        recordedAt: {
          gte: jstStringToDbDate(from),
          lt: jstStringToDbDate(addDaysYmd(to, 1)),
        },
      },
      orderBy: { recordedAt: "asc" },
    }),
    // 前期間のKPI（回数・合計・平均）は aggregate 1本で取る
    prisma.rpaScoutLog.aggregate({
      where: {
        ...whereMachine,
        recordedAt: {
          gte: jstStringToDbDate(prevFrom),
          lt: jstStringToDbDate(from),
        },
      },
      _count: { _all: true },
      _sum: { searchCount: true },
      _avg: { searchCount: true },
    }),
    // 条件分類には論理削除済みパターンも使う（過去ログの紐付け先になるため）
    prisma.rpaScoutPattern.findMany(),
    // 「30日以上未使用」判定用の全期間最終使用（patterns API と同じ方式）
    prisma.$queryRaw<LastUsedRow[]>`
      SELECT DISTINCT ON ("patternId") "patternId" AS key, "recordedAt", "machineNo"
      FROM rpa_scout_logs
      WHERE "patternId" IS NOT NULL
      ORDER BY "patternId", "recordedAt" DESC`,
    prisma.$queryRaw<LastUsedRow[]>`
      SELECT DISTINCT ON ("patternName") "patternName" AS key, "recordedAt", "machineNo"
      FROM rpa_scout_logs
      ORDER BY "patternName", "recordedAt" DESC`,
    prisma.rpaScoutMachine.findMany({ orderBy: { machineNo: "asc" } }),
  ]);

  // ---- ログ→パターン紐付け（patternId優先、null移行ログはパターン名完全一致でフォールバック） ----
  const patternById = new Map(patterns.map((p) => [p.id, p]));
  const patternByName = new Map<string, (typeof patterns)[number]>();
  for (const p of patterns) {
    const cur = patternByName.get(p.name);
    if (!cur || (!cur.isActive && p.isActive)) patternByName.set(p.name, p);
  }
  const resolvePattern = (log: (typeof logs)[number]) =>
    (log.patternId ? patternById.get(log.patternId) : undefined) ??
    patternByName.get(log.patternName) ??
    null;

  let unclassifiedLogCount = 0;
  for (const log of logs) if (!resolvePattern(log)) unclassifiedLogCount++;

  // ---- 条件軸別の使用構成 ----
  const tally = (labelOf: (p: (typeof patterns)[number]) => string | null) => {
    const map = new Map<string, number>();
    for (const log of logs) {
      const p = resolvePattern(log);
      const label = (p ? labelOf(p) : null) ?? UNCLASSIFIED;
      map.set(label, (map.get(label) ?? 0) + 1);
    }
    return map;
  };

  // 固定ラベル軸（円グラフ）: 0回でも全ラベルを返す
  const fixedAxis = (labels: string[], counts: Map<string, number>): AxisEntry[] => [
    ...labels.map((label) => ({ label, count: counts.get(label) ?? 0 })),
    { label: UNCLASSIFIED, count: counts.get(UNCLASSIFIED) ?? 0 },
  ];
  // 動的軸（横棒）: 回数降順、未分類は常に末尾（0回でも隠さない）
  const dynamicAxis = (counts: Map<string, number>): AxisEntry[] => {
    const entries = [...counts.entries()]
      .filter(([label, count]) => label !== UNCLASSIFIED && count > 0)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ja"));
    return [...entries, { label: UNCLASSIFIED, count: counts.get(UNCLASSIFIED) ?? 0 }];
  };

  const axes = {
    area: fixedAxis(["東日本", "西日本", "全国", "県指定"], tally(areaAxisLabel)),
    sendStatus: fixedAxis(["≪送信済≫向け", "【未送信】向け"], tally(sendStatusAxisLabel)),
    regist: dynamicAxis(tally(registAxisLabel)),
    gradYear: dynamicAxis(tally(gradYearAxisLabel)),
    companyCount: dynamicAxis(tally(companyCountAxisLabel)),
  };

  // ---- パターン使用回数（ユニーク数・TOP5共用。紐付けキー = パターンid、未紐付けはログのパターン名） ----
  const usage = new Map<string, { name: string; count: number }>();
  for (const log of logs) {
    const p = resolvePattern(log);
    const key = p ? p.id : `name:${log.patternName}`;
    const cur = usage.get(key);
    if (cur) cur.count++;
    else usage.set(key, { name: p ? p.name : log.patternName, count: 1 });
  }
  const top5 = [...usage.values()].sort((a, b) => b.count - a.count).slice(0, 5);

  // ---- アラート: 連続使用（期間末尾の直近3日間に同一パターンが3回以上。号機問わず） ----
  const windowFrom = addDaysYmd(to, -2);
  const contMap = new Map<
    string,
    { name: string; count: number; machineNos: Set<number>; lastAt: Date }
  >();
  for (const log of logs) {
    if (dbDateToJstYmd(log.recordedAt) < windowFrom) continue;
    const p = resolvePattern(log);
    const key = p ? p.id : `name:${log.patternName}`;
    const cur = contMap.get(key);
    if (cur) {
      cur.count++;
      cur.machineNos.add(log.machineNo);
      if (log.recordedAt > cur.lastAt) cur.lastAt = log.recordedAt;
    } else {
      contMap.set(key, {
        name: p ? p.name : log.patternName,
        count: 1,
        machineNos: new Set([log.machineNo]),
        lastAt: log.recordedAt,
      });
    }
  }
  const continuousUse: ContinuousUseAlert[] = [...contMap.values()]
    .filter((g) => g.count >= 3)
    .sort((a, b) => b.count - a.count)
    .map((g) => ({
      machineNos: [...g.machineNos].sort((a, b) => a - b),
      patternName: g.name,
      count: g.count,
      lastAt: toWire(g.lastAt),
    }));

  // ---- アラート: 件数下降（同一号機×同一パターンの直近2回の searchCount 比較） ----
  const dropMap = new Map<string, { machineNo: number; name: string; logs: (typeof logs)[number][] }>();
  for (const log of logs) {
    if (log.searchCount == null) continue; // 停止記録は比較対象外
    const p = resolvePattern(log);
    const key = `${log.machineNo}|${p ? p.id : `name:${log.patternName}`}`;
    const cur = dropMap.get(key);
    if (cur) cur.logs.push(log);
    else dropMap.set(key, { machineNo: log.machineNo, name: p ? p.name : log.patternName, logs: [log] });
  }
  const searchDrop: SearchDropAlert[] = [];
  for (const g of dropMap.values()) {
    if (g.logs.length < 2) continue;
    const prev = g.logs[g.logs.length - 2].searchCount!;
    const last = g.logs[g.logs.length - 1].searchCount!;
    if (prev <= 0) continue;
    const drop = (prev - last) / prev;
    if (drop > SEARCH_COUNT_DROP_THRESHOLD) {
      searchDrop.push({
        machineNo: g.machineNo,
        patternName: g.name,
        prevCount: prev,
        lastCount: last,
        dropPct: Math.round(drop * 100),
        lastAt: toWire(g.logs[g.logs.length - 1].recordedAt),
      });
    }
  }
  searchDrop.sort((a, b) => b.dropPct - a.dropPct);

  // ---- 号機別（稼働中のみ。号機指定時はその号機のみ＝停止号機の過去実績も見られる） ----
  const displayMachines = machines.filter((m) =>
    machineNo != null ? m.machineNo === machineNo : m.isActive
  );
  const machineRows = displayMachines.map((m) => {
    const mLogs = logs.filter((l) => l.machineNo === m.machineNo); // recordedAt昇順
    const latest = mLogs[mLogs.length - 1] ?? null;
    let prevDiffPct: number | null = null;
    if (mLogs.length >= 2) {
      const a = mLogs[mLogs.length - 2].searchCount;
      const b = mLogs[mLogs.length - 1].searchCount;
      // null（停止記録）含みは比較不能で省略
      if (a != null && b != null && a > 0) prevDiffPct = Math.round(((b - a) / a) * 100);
    }
    return {
      machineNo: m.machineNo,
      isActive: m.isActive,
      changeCount: mLogs.length,
      latestPatternName: latest?.patternName ?? null,
      latestSearchCount: latest?.searchCount ?? null,
      latestRecordedAt: latest ? toWire(latest.recordedAt) : null,
      recent5: mLogs.slice(-5).map((l) => l.searchCount),
      prevDiffPct,
    };
  });

  // ---- KPI ----
  const searchCounts = logs.map((l) => l.searchCount).filter((v): v is number => v != null);
  const searchTotal = searchCounts.reduce((s, v) => s + v, 0);
  const searchAvg = searchCounts.length ? Math.round(searchTotal / searchCounts.length) : null;

  // 30日以上未使用の有効パターン数（全期間・全号機横断の最終使用で判定）
  const lastById = new Map(lastByIdRows.map((r) => [r.key, r]));
  const lastByName = new Map(lastByNameRows.map((r) => [r.key, r]));
  const cutoff = addDaysYmd(nowJstYmd(), -30);
  const activePatterns = patterns.filter((p) => p.isActive);
  const unused30dCount = activePatterns.filter((p) => {
    const last = lastById.get(p.id) ?? lastByName.get(p.name);
    return !last || dbDateToJstYmd(last.recordedAt) < cutoff;
  }).length;

  const data: DashboardData = {
    period: { from, to, prevFrom, prevTo },
    kpi: {
      changeCount: logs.length,
      prevChangeCount: prevAgg._count._all,
      usedPatternCount: usage.size,
      activePatternTotal: activePatterns.length,
      unused30dCount,
      searchTotal,
      prevSearchTotal: prevAgg._sum.searchCount,
      searchAvg,
      prevSearchAvg: prevAgg._avg.searchCount != null ? Math.round(prevAgg._avg.searchCount) : null,
      continuousUseCount: continuousUse.length,
    },
    machineRows,
    allMachines: machines.map((m) => ({ machineNo: m.machineNo, isActive: m.isActive })),
    axes,
    top5,
    alerts: { continuousUse, searchDrop },
    meta: { queryCount: 6, unclassifiedLogCount },
  };

  return NextResponse.json(data);
}
