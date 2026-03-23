"use client";

import { useEffect, useState, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import RpaErrorNav from "@/components/rpa-error/RpaErrorNav";

type StatsData = {
  openCount: number;
  byMachineMonth: Record<string, Record<number, number>>;
  ranking: { patternName: string; count: number }[];
};

const COLORS = ["#2563EB", "#DC2626", "#16A34A", "#D97706", "#8B5CF6", "#EC4899", "#6B7280"];
const PERIOD_OPTIONS = [
  { label: "1ヶ月", months: 1 },
  { label: "3ヶ月", months: 3 },
  { label: "6ヶ月", months: 6 },
  { label: "1年", months: 12 },
];

export default function RpaErrorStatsPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [period, setPeriod] = useState(3);

  const loadStats = useCallback(async () => {
    const from = new Date();
    from.setMonth(from.getMonth() - period);
    const res = await fetch(`/api/rpa-error/stats?from=${from.toISOString()}`);
    if (res.ok) {
      const data = await res.json();
      setStats(data);
    }
  }, [period]);

  useEffect(() => { loadStats(); }, [loadStats]);

  // グラフデータ変換
  const chartData = stats
    ? Object.entries(stats.byMachineMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, machines]) => ({
          month,
          ...Object.fromEntries(
            [1, 2, 3, 4, 5, 6, 7].map((n) => [`${n}号機`, machines[n] || 0])
          ),
        }))
    : [];

  return (
    <div>
      <RpaErrorNav />
      <h1 className="text-[20px] font-bold text-[#374151]">RPAエラー統計</h1>

      {/* 期間フィルター */}
      <div className="mt-4 flex gap-2">
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.months}
            onClick={() => setPeriod(opt.months)}
            className={`rounded-md px-3 py-1.5 text-[13px] ${
              period === opt.months
                ? "bg-[#2563EB] text-white"
                : "bg-[#F3F4F6] text-[#374151] hover:bg-[#E5E7EB]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {!stats ? (
        <div className="mt-8 text-center text-[#9CA3AF]">読み込み中...</div>
      ) : (
        <>
          {/* 未対応件数 */}
          <div className="mt-6 rounded-lg border border-[#E5E7EB] bg-white p-6">
            <span className="text-[13px] text-[#6B7280]">未対応エラー件数</span>
            <div className={`text-[40px] font-bold ${stats.openCount > 0 ? "text-[#DC2626]" : "text-[#16A34A]"}`}>
              {stats.openCount}
            </div>
          </div>

          {/* 号機別月別チャート */}
          <div className="mt-6 rounded-lg border border-[#E5E7EB] bg-white p-6">
            <h2 className="text-[15px] font-semibold text-[#374151] mb-4">号機別エラー件数（月別）</h2>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <Bar key={n} dataKey={`${n}号機`} fill={COLORS[n - 1]} stackId="a" />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-[14px] text-[#9CA3AF] py-8 text-center">データがありません</p>
            )}
          </div>

          {/* エラーパターンランキング */}
          <div className="mt-6 rounded-lg border border-[#E5E7EB] bg-white p-6">
            <h2 className="text-[15px] font-semibold text-[#374151] mb-4">エラーパターンランキング（上位5件）</h2>
            {stats.ranking.length > 0 ? (
              <div className="space-y-2">
                {stats.ranking.map((r, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-6 text-[14px] font-bold text-[#6B7280]">{i + 1}.</span>
                    <span className="flex-1 text-[14px] text-[#374151]">{r.patternName}</span>
                    <span className="text-[14px] font-semibold text-[#374151]">{r.count}件</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[14px] text-[#9CA3AF]">データがありません</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
