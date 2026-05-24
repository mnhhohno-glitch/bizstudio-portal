"use client";

import { useEffect, useState, useCallback } from "react";
import ScoutNav from "@/components/scout/ScoutNav";

type Bucket = { key: string; deliveryCount: number; openCount: number; applyCount: number };

type Stats = {
  axis: string;
  groupBy: string;
  overall: Bucket[];
  subBuckets: Record<string, Bucket[]>;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

export default function ByDeliveryDatePage() {
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [groupBy, setGroupBy] = useState<"day" | "week" | "month">("day");
  const [axis, setAxis] = useState<"overall" | "media" | "machine" | "category">("overall");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(
      `/api/scout/stats?axis=${axis}&from=${from}&to=${to}&groupBy=${groupBy}&dateMode=sent`,
    );
    if (res.ok) setStats(await res.json());
    setLoading(false);
  }, [from, to, groupBy, axis]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <ScoutNav />
      <h1 className="text-[20px] font-bold text-[#374151]">配信日別集計</h1>

      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-[#E5E7EB] bg-white p-3">
        <label className="text-[12px] text-[#6B7280]">期間:</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
        />
        <span>〜</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
        />

        <span className="ml-4 text-[12px] text-[#6B7280]">単位:</span>
        {(["day", "week", "month"] as const).map((g) => (
          <button
            key={g}
            onClick={() => setGroupBy(g)}
            className={`rounded px-3 py-1 text-[12px] ${
              groupBy === g ? "bg-[#2563EB] text-white" : "border border-[#E5E7EB] text-[#6B7280]"
            }`}
          >
            {g === "day" ? "日" : g === "week" ? "週" : "月"}
          </button>
        ))}

        <span className="ml-4 text-[12px] text-[#6B7280]">軸:</span>
        {(["overall", "media", "machine", "category"] as const).map((a) => (
          <button
            key={a}
            onClick={() => setAxis(a)}
            className={`rounded px-3 py-1 text-[12px] ${
              axis === a ? "bg-[#2563EB] text-white" : "border border-[#E5E7EB] text-[#6B7280]"
            }`}
          >
            {a === "overall" ? "全体" : a === "media" ? "媒体" : a === "machine" ? "号機" : "配信種別"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-6 text-[#9CA3AF]">読み込み中...</p>
      ) : !stats ? (
        <p className="mt-6 text-[#9CA3AF]">データがありません</p>
      ) : axis === "overall" ? (
        <StatsTable buckets={stats.overall} />
      ) : (
        <>
          {Object.entries(stats.subBuckets).length === 0 ? (
            <p className="mt-6 text-[#9CA3AF]">データがありません</p>
          ) : (
            Object.entries(stats.subBuckets).map(([key, buckets]) => (
              <div key={key} className="mt-6">
                <h3 className="text-[14px] font-semibold text-[#374151] mb-2">{key}</h3>
                <StatsTable buckets={buckets} />
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}

function StatsTable({ buckets }: { buckets: Bucket[] }) {
  const totals = buckets.reduce(
    (acc, b) => ({
      d: acc.d + b.deliveryCount,
      o: acc.o + b.openCount,
      a: acc.a + b.applyCount,
    }),
    { d: 0, o: 0, a: 0 },
  );
  return (
    <div className="overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white">
      <table className="w-full text-[13px]">
        <thead className="bg-[#F9FAFB] text-[#6B7280]">
          <tr>
            <th className="px-3 py-2 text-left">期間</th>
            <th className="px-3 py-2 text-right">配信</th>
            <th className="px-3 py-2 text-right">開封</th>
            <th className="px-3 py-2 text-right">開封率</th>
            <th className="px-3 py-2 text-right">応募</th>
            <th className="px-3 py-2 text-right">応募率</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => {
            const oRate = b.deliveryCount > 0 ? (b.openCount / b.deliveryCount) * 100 : 0;
            const aRate = b.deliveryCount > 0 ? (b.applyCount / b.deliveryCount) * 100 : 0;
            return (
              <tr key={b.key} className="border-t border-[#F3F4F6]">
                <td className="px-3 py-1.5">{b.key}</td>
                <td className="px-3 py-1.5 text-right">{b.deliveryCount.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right">{b.openCount.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right">{oRate.toFixed(1)}%</td>
                <td className="px-3 py-1.5 text-right">{b.applyCount.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right">{aRate.toFixed(1)}%</td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-[#9CA3AF] bg-[#F9FAFB] font-medium">
            <td className="px-3 py-2">合計</td>
            <td className="px-3 py-2 text-right">{totals.d.toLocaleString()}</td>
            <td className="px-3 py-2 text-right">{totals.o.toLocaleString()}</td>
            <td className="px-3 py-2 text-right">
              {totals.d > 0 ? ((totals.o / totals.d) * 100).toFixed(1) : "0.0"}%
            </td>
            <td className="px-3 py-2 text-right">{totals.a.toLocaleString()}</td>
            <td className="px-3 py-2 text-right">
              {totals.d > 0 ? ((totals.a / totals.d) * 100).toFixed(1) : "0.0"}%
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
