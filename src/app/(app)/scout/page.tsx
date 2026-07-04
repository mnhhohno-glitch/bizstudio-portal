"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ScoutNav from "@/components/scout/ScoutNav";

type Bucket = { key: string; deliveryCount: number; openCount: number; applyCount: number };
type StatsResponse = { overall: Bucket[]; subBuckets: Record<string, Bucket[]> };

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function ScoutDashboardPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const monthEnd = today;

    fetch(
      `/api/scout/stats?axis=overall&from=${fmtDate(monthStart)}&to=${fmtDate(monthEnd)}&groupBy=day`,
    )
      .then((r) => r.json())
      .then((d) => setStats(d))
      .finally(() => setLoading(false));
  }, []);

  const totals = (stats?.overall || []).reduce(
    (acc, b) => ({
      delivery: acc.delivery + b.deliveryCount,
      open: acc.open + b.openCount,
      apply: acc.apply + b.applyCount,
    }),
    { delivery: 0, open: 0, apply: 0 },
  );

  const openRate = totals.delivery > 0 ? (totals.open / totals.delivery) * 100 : 0;
  const applyRate = totals.delivery > 0 ? (totals.apply / totals.delivery) * 100 : 0;

  return (
    <div>
      <ScoutNav />
      <h1 className="text-[20px] font-bold text-[#374151]">スカウト運用ダッシュボード</h1>
      <p className="mt-1 text-[13px] text-[#6B7280]">今月の主要指標</p>

      {loading ? (
        <p className="mt-6 text-[#9CA3AF]">読み込み中...</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Card label="配信数" value={totals.delivery.toLocaleString()} />
            <Card label="開封数" value={totals.open.toLocaleString()} />
            <Card label="開封率" value={`${openRate.toFixed(1)}%`} />
            <Card label="応募数" value={totals.apply.toLocaleString()} />
            <Card label="応募率" value={`${applyRate.toFixed(2)}%`} />
          </div>

          <div className="mt-6 rounded-lg border border-[#E5E7EB] bg-white p-5">
            <h2 className="text-[16px] font-semibold text-[#374151]">日別推移（今月）</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-[#6B7280]">
                  <tr>
                    <th className="px-3 py-2 text-left">日付</th>
                    <th className="px-3 py-2 text-right">配信</th>
                    <th className="px-3 py-2 text-right">開封</th>
                    <th className="px-3 py-2 text-right">応募</th>
                  </tr>
                </thead>
                <tbody>
                  {(stats?.overall || []).map((b) => (
                    <tr key={b.key} className="border-t border-[#F3F4F6]">
                      <td className="px-3 py-1.5">{b.key}</td>
                      <td className="px-3 py-1.5 text-right">{b.deliveryCount}</td>
                      <td className="px-3 py-1.5 text-right">{b.openCount}</td>
                      <td className="px-3 py-1.5 text-right">{b.applyCount}</td>
                    </tr>
                  ))}
                  {(stats?.overall || []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-[#9CA3AF]">
                        データがありません
                      </td>
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
        </>
      )}
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
