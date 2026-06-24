"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList,
  PieChart, Pie,
} from "recharts";

/* ---------- Types ---------- */
type DashboardData = {
  lastLoginAt: string | null;
  mypageAccessCount: number | null;
  idleDays: number | null;
  lastContactDate: string | null;
  nextContactDate: string | null;
  interestedCount: number;
  wantToApplyCount: number;
  lastProposalDate: string | null;
  deliveryCount: number;
  entryCompanies: number;
  inSelectionCompanies: number;
  funnel: { entry: number; doc: number; first: number; second: number; offer: number };
  passRate: { doc: number | null; first: number | null; second: number | null };
};

/* ---------- Helpers ---------- */
const DASH = "—";
function dash(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return DASH;
  return String(v);
}

// 放置日数 信号色: 緑 ≤7 / 黄 8〜14 / 赤 15〜 / 灰 null
function idleSignal(d: number | null): { bg: string; fg: string; label: string } {
  if (d === null) return { bg: "#F3F4F6", fg: "#6B7280", label: "接触記録なし" };
  if (d <= 7) return { bg: "#DCFCE7", fg: "#16A34A", label: "良好" };
  if (d <= 14) return { bg: "#FEF9C3", fg: "#CA8A04", label: "やや放置" };
  return { bg: "#FEE2E2", fg: "#DC2626", label: "要対応" };
}

/* ---------- Small UI atoms ---------- */
function Card({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-3">
      <div className="text-[12px] text-[#6B7280]">{label}</div>
      <div className="mt-1 text-[20px] font-semibold leading-tight" style={{ color: accent ?? "#374151" }}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-[#9CA3AF]">{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-6 text-[14px] font-semibold text-[#374151]">{children}</h3>;
}

const FUNNEL_COLORS = ["#2563EB", "#3B82F6", "#60A5FA", "#93C5FD", "#16A34A"];

export default function DashboardTab({ candidateId }: { candidateId: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(`/api/candidates/${candidateId}/dashboard`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [candidateId]);

  if (loading) return <div className="py-12 text-center text-[#9CA3AF]">読み込み中...</div>;
  if (error || !data) return <div className="py-12 text-center text-[#DC2626]">ダッシュボードの取得に失敗しました</div>;

  const sig = idleSignal(data.idleDays);
  const funnelData = [
    { stage: "エントリー", value: data.funnel.entry },
    { stage: "書類", value: data.funnel.doc },
    { stage: "一次", value: data.funnel.first },
    { stage: "二次", value: data.funnel.second },
    { stage: "内定", value: data.funnel.offer },
  ];
  const responseTotal = data.interestedCount + data.wantToApplyCount;
  const donutData = [
    { name: "気になる", value: data.interestedCount },
    { name: "応募したい", value: data.wantToApplyCount },
  ];

  const passRow = (label: string, v: number | null) => (
    <div className="flex items-center justify-between rounded-md bg-[#F9FAFB] px-3 py-2">
      <span className="text-[12px] text-[#6B7280]">{label}</span>
      <span className="text-[15px] font-semibold text-[#374151]">{v === null ? DASH : `${v}%`}</span>
    </div>
  );

  return (
    <div className="pb-8">
      {/* ===== 最上段: 放置日数 信号 + 3カード ===== */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border px-4 py-3" style={{ backgroundColor: sig.bg, borderColor: sig.fg + "55" }}>
          <div className="text-[12px]" style={{ color: sig.fg }}>放置日数</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[34px] font-bold leading-none" style={{ color: sig.fg }}>{data.idleDays === null ? DASH : data.idleDays}</span>
            {data.idleDays !== null && <span className="text-[13px]" style={{ color: sig.fg }}>日</span>}
          </div>
          <div className="mt-1 text-[11px] font-medium" style={{ color: sig.fg }}>{sig.label}</div>
        </div>
        <Card label="最終ログイン" value={dash(data.lastLoginAt)} sub="マイページ" />
        <Card label="最終接触" value={dash(data.lastContactDate)} sub="面談/メモ/求人提案の最新" />
        <Card label="次回連絡予定" value={dash(data.nextContactDate)} sub="面談予定/タスク期限" />
      </div>

      {/* ===== ① 本人の動き ===== */}
      <SectionTitle>① 本人の動き</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card label="マイページ閲覧回数" value={dash(data.mypageAccessCount)} sub="累計（直近30日ではありません）" accent="#2563EB" />
        <Card label="気になる" value={data.interestedCount} accent="#CA8A04" />
        <Card label="応募したい" value={data.wantToApplyCount} accent="#2563EB" />
      </div>

      {/* ===== ② こちらの対応 ===== */}
      <SectionTitle>② こちらの対応</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card label="最終求人提案日" value={dash(data.lastProposalDate)} />
        <Card label="求人配信数" value={data.deliveryCount} sub="マイページ送信済（出力済BM）" />
        <Card label="最終接触日" value={dash(data.lastContactDate)} />
      </div>

      {/* ===== ③ 選考の進み ===== */}
      <SectionTitle>③ 選考の進み</SectionTitle>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ファネル（主役） */}
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-4 lg:col-span-2">
          <div className="mb-2 text-[12px] text-[#6B7280]">選考ファネル（会社単位）</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={funnelData} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#9CA3AF" }} />
              <YAxis type="category" dataKey="stage" width={64} tick={{ fontSize: 12, fill: "#374151" }} />
              <Tooltip formatter={(value) => [`${value} 社`, ""]} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {funnelData.map((_, i) => <Cell key={i} fill={FUNNEL_COLORS[i]} />)}
                <LabelList dataKey="value" position="right" style={{ fontSize: 12, fill: "#374151" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* 通過率 + 社数 */}
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
            <div className="mb-2 text-[12px] text-[#6B7280]">通過率（母数3社未満は{DASH}）</div>
            <div className="flex flex-col gap-2">
              {passRow("書類通過率", data.passRate.doc)}
              {passRow("一次通過率", data.passRate.first)}
              {passRow("二次通過率", data.passRate.second)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Card label="エントリー社数" value={data.entryCompanies} />
            <Card label="選考中企業数" value={data.inSelectionCompanies} accent="#16A34A" />
          </div>
        </div>
      </div>

      {/* ===== 補助: マイページ反応ドーナツ ===== */}
      <SectionTitle>マイページ反応</SectionTitle>
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
        {responseTotal === 0 ? (
          <div className="py-8 text-center text-[13px] text-[#9CA3AF]">反応データがありません</div>
        ) : (
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={180} height={180}>
              <PieChart>
                <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  <Cell fill="#CA8A04" />
                  <Cell fill="#2563EB" />
                </Pie>
                <Tooltip formatter={(value, name) => [`${value} 件`, name]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-2 text-[13px]">
              <div className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: "#CA8A04" }} />気になる <span className="font-semibold">{data.interestedCount}</span></div>
              <div className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: "#2563EB" }} />応募したい <span className="font-semibold">{data.wantToApplyCount}</span></div>
              <div className="text-[11px] text-[#9CA3AF]">計 {responseTotal} 件の反応</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
