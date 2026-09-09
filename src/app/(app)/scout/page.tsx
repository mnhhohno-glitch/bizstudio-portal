"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ScoutNav from "@/components/scout/ScoutNav";
import ScoutTrendChart, { type TrendPoint, type Comparison, type Unit } from "./_components/ScoutTrendChart";

type Bucket = { key: string; deliveryCount: number; openCount: number; applyCount: number };
type StatsResponse = { overall: Bucket[]; subBuckets: Record<string, Bucket[]> };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
/** JST の当日 YYYY-MM-DD（罠#17: toISOString は使わない） */
function jstToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}
/** baseYmd が属する月から delta ヶ月ずらした月の 1日〜末日（analytics の snapMonth と同仕様） */
function snapMonth(baseYmd: string, delta: number): { from: string; to: string } {
  const [y0, m0] = baseYmd.split("-").map(Number);
  let y = y0;
  let m = m0 + delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay)}` };
}

type Period = { from: string; to: string; groupBy: "day" | "hour" | "month" };

function primaryPeriod(unit: Unit, anchor: string): Period {
  if (unit === "month") {
    const y = Number(anchor.slice(0, 4));
    return { from: `${y}-01-01`, to: `${y}-12-31`, groupBy: "month" };
  }
  const m = snapMonth(anchor, 0);
  return { from: m.from, to: m.to, groupBy: unit === "hour" ? "hour" : "day" };
}

function comparisonPeriod(unit: Unit, comparison: Comparison, anchor: string): Period | null {
  if (comparison === "none") return null;
  if (unit === "month") {
    // 月別は前年比較のみ意味を持つ（前月は12ヶ月バケットに整合しないため前年扱い）
    const y = Number(anchor.slice(0, 4)) - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31`, groupBy: "month" };
  }
  if (comparison === "prevMonth") {
    const m = snapMonth(anchor, -1);
    return { from: m.from, to: m.to, groupBy: unit === "hour" ? "hour" : "day" };
  }
  // prevYear（日別/時間別）: 同じ月の1年前
  const [y, mo] = anchor.split("-").map(Number);
  const m = snapMonth(`${y - 1}-${pad(mo)}-01`, 0);
  return { from: m.from, to: m.to, groupBy: unit === "hour" ? "hour" : "day" };
}

/** バケットキー → グラフの x ラベル（日番号 / 時 / 月番号） */
function labelOf(unit: Unit, bucketKey: string): string {
  if (unit === "day") return String(Number(bucketKey.slice(8, 10)));
  if (unit === "hour") return bucketKey; // "8".."19"
  return String(Number(bucketKey.slice(5, 7))); // "YYYY-MM" → 月番号
}

/** x 軸に並べる全ラベル領域（データ無しラベルも空バーで場所を確保） */
function domainLabels(unit: Unit, primary: Period): string[] {
  if (unit === "hour") return Array.from({ length: 12 }, (_, i) => String(8 + i)); // 8..19
  if (unit === "month") return Array.from({ length: 12 }, (_, i) => String(i + 1)); // 1..12
  const lastDay = Number(primary.to.slice(8, 10));
  return Array.from({ length: lastDay }, (_, i) => String(i + 1)); // 1..末日
}

const UNIT_LABELS: Record<Unit, string> = { day: "日別", hour: "時間別", month: "月別" };
const CMP_LABELS: Record<Comparison, string> = { none: "比較なし", prevMonth: "前月", prevYear: "前年" };

export default function ScoutDashboardPage() {
  const [unit, setUnit] = useState<Unit>("day");
  const [comparison, setComparison] = useState<Comparison>("none");
  const [anchor, setAnchor] = useState<string>(jstToday());

  const [primaryBuckets, setPrimaryBuckets] = useState<Bucket[]>([]);
  const [cmpBuckets, setCmpBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(true);

  const primary = useMemo(() => primaryPeriod(unit, anchor), [unit, anchor]);
  const cmp = useMemo(() => comparisonPeriod(unit, comparison, anchor), [unit, comparison, anchor]);

  // 月別のとき前月比較は前年に丸められるため、UI 選択肢を整理
  const availableComparisons: Comparison[] = unit === "month" ? ["none", "prevYear"] : ["none", "prevMonth", "prevYear"];

  useEffect(() => {
    let active = true;
    const pUrl = `/api/scout/stats?axis=overall&dateMode=sent&from=${primary.from}&to=${primary.to}&groupBy=${primary.groupBy}`;
    const fetches: Promise<StatsResponse>[] = [fetch(pUrl).then((r) => r.json())];
    if (cmp) {
      const cUrl = `/api/scout/stats?axis=overall&dateMode=sent&from=${cmp.from}&to=${cmp.to}&groupBy=${cmp.groupBy}`;
      fetches.push(fetch(cUrl).then((r) => r.json()));
    }
    Promise.all(fetches)
      .then(([p, c]) => {
        if (!active) return;
        setPrimaryBuckets(p.overall || []);
        setCmpBuckets(c ? c.overall || [] : []);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [primary.from, primary.to, primary.groupBy, cmp]);

  // KPI（主系列の合計）
  const totals = primaryBuckets.reduce(
    (acc, b) => ({ delivery: acc.delivery + b.deliveryCount, open: acc.open + b.openCount, apply: acc.apply + b.applyCount }),
    { delivery: 0, open: 0, apply: 0 },
  );
  const openRate = totals.delivery > 0 ? (totals.open / totals.delivery) * 100 : 0;
  const applyRate = totals.delivery > 0 ? (totals.apply / totals.delivery) * 100 : 0;

  // グラフ用にバケットをラベル領域へマージ
  const chartData: TrendPoint[] = useMemo(() => {
    const pMap = new Map(primaryBuckets.map((b) => [labelOf(unit, b.key), b]));
    const cMap = new Map(cmpBuckets.map((b) => [labelOf(unit, b.key), b]));
    return domainLabels(unit, primary).map((lbl) => {
      const p = pMap.get(lbl);
      const c = cMap.get(lbl);
      const rate = (b?: Bucket): number | null => (b && b.deliveryCount > 0 ? (b.applyCount / b.deliveryCount) * 100 : null);
      return {
        label: lbl,
        delivery: p ? p.deliveryCount : null,
        apply: p ? p.applyCount : null,
        applyRate: rate(p),
        cmpDelivery: c ? c.deliveryCount : null,
        cmpApply: c ? c.applyCount : null,
        cmpApplyRate: rate(c),
      };
    });
  }, [primaryBuckets, cmpBuckets, unit, primary]);

  // 期間表示ラベル
  const periodLabel = unit === "month" ? `${anchor.slice(0, 4)}年` : `${primary.from.slice(0, 4)}年${Number(primary.from.slice(5, 7))}月`;
  const stepUnit = unit === "month" ? "年" : "月";

  const goPrev = () => {
    if (unit === "month") {
      const y = Number(anchor.slice(0, 4)) - 1;
      setAnchor(`${y}-${anchor.slice(5)}`);
    } else {
      setAnchor(snapMonth(anchor, -1).from);
    }
  };
  const goNext = () => {
    if (unit === "month") {
      const y = Number(anchor.slice(0, 4)) + 1;
      setAnchor(`${y}-${anchor.slice(5)}`);
    } else {
      setAnchor(snapMonth(anchor, 1).from);
    }
  };
  const goCurrent = () => setAnchor(jstToday());

  return (
    <div>
      <ScoutNav />
      <h1 className="text-[20px] font-bold text-[#374151]">スカウト運用ダッシュボード</h1>
      <p className="mt-1 text-[13px] text-[#6B7280]">{periodLabel}の主要指標</p>

      {/* KPI カード（選択期間の合計） */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card label="配信数" value={totals.delivery.toLocaleString()} />
        <Card label="開封数" value={totals.open.toLocaleString()} />
        <Card label="開封率" value={`${openRate.toFixed(1)}%`} />
        <Card label="応募数" value={totals.apply.toLocaleString()} />
        <Card label="応募率" value={`${applyRate.toFixed(2)}%`} />
      </div>

      {/* グラフセクション */}
      <div className="mt-6 rounded-lg border border-[#E5E7EB] bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[16px] font-semibold text-[#374151]">推移グラフ</h2>
          <div className="flex flex-wrap items-center gap-3">
            {/* 表示単位トグル */}
            <div className="inline-flex rounded-lg border border-[#E5E7EB] p-1">
              {(["day", "hour", "month"] as const).map((u) => (
                <button
                  key={u}
                  onClick={() => setUnit(u)}
                  className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${
                    unit === u ? "bg-[#2563EB] text-white" : "text-[#6B7280] hover:text-[#374151]"
                  }`}
                >
                  {UNIT_LABELS[u]}
                </button>
              ))}
            </div>
            {/* 比較トグル */}
            <div className="inline-flex rounded-lg border border-[#E5E7EB] p-1">
              {availableComparisons.map((c) => (
                <button
                  key={c}
                  onClick={() => setComparison(c)}
                  className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${
                    comparison === c ? "bg-[#16A34A] text-white" : "text-[#6B7280] hover:text-[#374151]"
                  }`}
                >
                  {CMP_LABELS[c]}
                </button>
              ))}
            </div>
            {/* ◀｜当月/当年｜▶ */}
            <div className="flex rounded-md border border-[#E5E7EB]">
              <button onClick={goPrev} className="flex h-[30px] w-[30px] items-center justify-center rounded-l-md text-[14px] text-[#6B7280] hover:bg-[#F9FAFB]" title={`前${stepUnit}`}>◀</button>
              <button onClick={goCurrent} className="flex h-[30px] items-center justify-center border-x border-[#E5E7EB] px-3 text-[12px] text-[#6B7280] hover:bg-[#F9FAFB]" title={unit === "month" ? "当年" : "当月"}>{unit === "month" ? "当年" : "当月"}</button>
              <button onClick={goNext} className="flex h-[30px] w-[30px] items-center justify-center rounded-r-md text-[14px] text-[#6B7280] hover:bg-[#F9FAFB]" title={`翌${stepUnit}`}>▶</button>
            </div>
          </div>
        </div>

        <p className="mt-1 text-[12px] text-[#9CA3AF]">
          棒=配信数・応募数（左軸）／ 線=応募率（右軸）。{comparison !== "none" && `${CMP_LABELS[comparison]}を半透明＋点線で重ね描き。`}配信0の点は応募率の線を切ります。
        </p>

        <div className="mt-3">
          {loading ? (
            <p className="py-16 text-center text-[#9CA3AF]">読み込み中...</p>
          ) : chartData.every((d) => d.delivery == null && d.cmpDelivery == null) ? (
            <p className="py-16 text-center text-[#9CA3AF]">データがありません</p>
          ) : (
            <ScoutTrendChart data={chartData} comparison={comparison} unit={unit} />
          )}
        </div>
      </div>

      {/* 明細テーブル（主系列） */}
      <div className="mt-6 rounded-lg border border-[#E5E7EB] bg-white p-5">
        <h2 className="text-[16px] font-semibold text-[#374151]">{UNIT_LABELS[unit]}推移（{periodLabel}）</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-[#6B7280]">
              <tr>
                <th className="px-3 py-2 text-left">{unit === "hour" ? "時間帯" : unit === "month" ? "月" : "日付"}</th>
                <th className="px-3 py-2 text-right">配信</th>
                <th className="px-3 py-2 text-right">開封</th>
                <th className="px-3 py-2 text-right">応募</th>
                <th className="px-3 py-2 text-right">応募率</th>
              </tr>
            </thead>
            <tbody>
              {primaryBuckets.map((b) => (
                <tr key={b.key} className="border-t border-[#F3F4F6]">
                  <td className="px-3 py-1.5">{unit === "hour" ? `${b.key}時` : b.key}</td>
                  <td className="px-3 py-1.5 text-right">{b.deliveryCount.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">{b.openCount.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">{b.applyCount.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">{b.deliveryCount > 0 ? `${((b.applyCount / b.deliveryCount) * 100).toFixed(2)}%` : "—"}</td>
                </tr>
              ))}
              {primaryBuckets.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-[#9CA3AF]">データがありません</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3 text-[13px]">
        <Link href="/scout/analytics?view=sent" className="text-[#2563EB] hover:underline">→ 配信日別集計</Link>
        <Link href="/scout/analytics?view=applied" className="text-[#2563EB] hover:underline">→ 応募日別集計</Link>
        <Link href="/scout/analytics?view=media" className="text-[#2563EB] hover:underline">→ 媒体別集計</Link>
        <Link href="/scout/slots" className="text-[#2563EB] hover:underline">→ 配信枠管理</Link>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
      <p className="text-[12px] text-[#6B7280]">{label}</p>
      <p className="mt-1 text-[22px] font-bold text-[#374151]">{value}</p>
    </div>
  );
}
