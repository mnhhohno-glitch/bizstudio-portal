"use client";

import { useEffect, useState, useCallback } from "react";
import ScoutNav from "@/components/scout/ScoutNav";
import { formatRecruiterName } from "@/lib/recruiterDisplay";

type Bucket = { key: string; deliveryCount: number; openCount: number; applyCount: number };
type Stats = { subBuckets: Record<string, Bucket[]> };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

export default function ByMediaPage() {
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [mediaStats, setMediaStats] = useState<Stats | null>(null);
  const [machineStats, setMachineStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [m1, m2] = await Promise.all([
      fetch(`/api/scout/stats?axis=media&from=${from}&to=${to}&groupBy=day&dateMode=sent`).then(
        (r) => r.json(),
      ),
      fetch(`/api/scout/stats?axis=machine&from=${from}&to=${to}&groupBy=day&dateMode=sent`).then(
        (r) => r.json(),
      ),
    ]);
    setMediaStats(m1);
    setMachineStats(m2);
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const summarize = (stats: Stats | null) => {
    if (!stats) return [];
    return Object.entries(stats.subBuckets).map(([key, buckets]) => {
      const totals = buckets.reduce(
        (acc, b) => ({
          d: acc.d + b.deliveryCount,
          o: acc.o + b.openCount,
          a: acc.a + b.applyCount,
        }),
        { d: 0, o: 0, a: 0 },
      );
      return { key, ...totals };
    });
  };

  return (
    <div>
      <ScoutNav />
      <h1 className="text-[20px] font-bold text-[#374151]">媒体・アカウント別集計</h1>

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
      </div>

      {loading ? (
        <p className="mt-6 text-[#9CA3AF]">読み込み中...</p>
      ) : (
        <>
          <Section title="媒体別" rows={summarize(mediaStats)} />
          <Section title="アカウント別（号機・社員）" rows={summarize(machineStats)} />
        </>
      )}
    </div>
  );
}

function Section({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; d: number; o: number; a: number }>;
}) {
  return (
    <div className="mt-6">
      <h2 className="text-[14px] font-semibold text-[#374151] mb-2">{title}</h2>
      <div className="overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white">
        <table className="w-full text-[13px]">
          <thead className="bg-[#F9FAFB] text-[#6B7280]">
            <tr>
              <th className="px-3 py-2 text-left">名称</th>
              <th className="px-3 py-2 text-right">配信</th>
              <th className="px-3 py-2 text-right">開封</th>
              <th className="px-3 py-2 text-right">開封率</th>
              <th className="px-3 py-2 text-right">応募</th>
              <th className="px-3 py-2 text-right">応募率</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[#9CA3AF]">
                  データがありません
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.key} className="border-t border-[#F3F4F6]">
                  <td className="px-3 py-1.5">{formatRecruiterName(r.key)}</td>
                  <td className="px-3 py-1.5 text-right">{r.d.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">{r.o.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">
                    {r.d > 0 ? ((r.o / r.d) * 100).toFixed(1) : "0.0"}%
                  </td>
                  <td className="px-3 py-1.5 text-right">{r.a.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">
                    {r.d > 0 ? ((r.a / r.d) * 100).toFixed(1) : "0.0"}%
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
