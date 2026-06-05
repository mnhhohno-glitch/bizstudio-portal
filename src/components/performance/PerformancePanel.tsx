"use client";

// T-071: 実績表パネル。ダッシュボード「スケジュール（日報）」タブの右エリアに置く。
// - 担当セレクト（CA 一覧）で対象を切替（初期=ログインユーザー本人）
// - 期間タブ（日/週/月/3か月/半期/年）で集計レンジを切替
// - 日報と同じ CA 指標を「数 + 率」で表示
// 担当・期間が変わるたび GET /api/performance を再フェッチ（SchedulePanel と同じ Client fetch）。

import { useState, useEffect, useCallback } from "react";

type CountWithRate = { count: number; denominator?: number; rate?: number | null };

type RangeMetrics = {
  firstInterviewPlanned: number;
  firstInterviewExecuted: number;
  firstInterviewRate: number | null;
  existingInterviewExecuted: number;
  interviewPrepExecuted: number;
  jobSearched: number;
  jobIntroduced: number;
  jobIntroductionRate: number | null;
  entry: CountWithRate;
  documentPass: CountWithRate;
  offer: CountWithRate;
  acceptance: CountWithRate;
};

type Advisor = { id: string; name: string };

const PERIODS: { key: string; label: string }[] = [
  { key: "day", label: "日" },
  { key: "week", label: "週" },
  { key: "month", label: "月" },
  { key: "quarter", label: "3か月" },
  { key: "half", label: "半期" },
  { key: "year", label: "年" },
];

const pct = (r: number | null | undefined) =>
  r === null || r === undefined ? "—" : `${(r * 100).toFixed(1)}%`;

export default function PerformancePanel() {
  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>("month");
  const [periods, setPeriods] = useState<Record<string, RangeMetrics> | null>(null);
  const [loading, setLoading] = useState(false);

  // 担当一覧 + 本人を初期ロード
  useEffect(() => {
    fetch("/api/performance/advisors")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setAdvisors(data.advisors || []);
        setEmployeeId(data.selfEmployeeId ?? data.advisors?.[0]?.id ?? null);
      })
      .catch(() => {});
  }, []);

  const fetchPerformance = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/performance?employeeId=${employeeId}`);
      if (res.ok) {
        const data = await res.json();
        setPeriods(data.periods || null);
      }
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void fetchPerformance();
  }, [fetchPerformance]);

  const m = periods?.[period] ?? null;

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB] gap-2">
        <h2 className="text-[14px] font-medium text-[#374151] flex items-center gap-1.5 shrink-0">
          📊 実績表
        </h2>
        <select
          value={employeeId ?? ""}
          onChange={(e) => setEmployeeId(e.target.value || null)}
          className="text-[12px] border border-gray-200 rounded px-2 py-1 bg-white focus:ring-1 focus:ring-[#2563EB] max-w-[160px]"
        >
          {advisors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {/* 期間タブ */}
      <div className="flex gap-1 px-3 py-2 border-b border-[#F3F4F6] flex-wrap">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-2.5 py-1 text-[12px] rounded-md border transition-colors ${
              period === p.key
                ? "bg-[#2563EB] text-white border-[#2563EB]"
                : "border-gray-200 text-[#6B7280] hover:bg-gray-50"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 指標テーブル */}
      <div className="px-4 py-3">
        {loading ? (
          <div className="py-8 text-center text-[13px] text-[#9CA3AF]">読み込み中...</div>
        ) : !m ? (
          <div className="py-8 text-center text-[13px] text-[#9CA3AF]">データがありません</div>
        ) : (
          <div className="space-y-3">
            <MetricSection title="面談">
              <MetricRow label="初回面談 予定" value={m.firstInterviewPlanned} />
              <MetricRow label="初回面談 実施" value={m.firstInterviewExecuted} sub={`実施率 ${pct(m.firstInterviewRate)}`} />
              <MetricRow label="既存面談" value={m.existingInterviewExecuted} />
              <MetricRow label="面接対策" value={m.interviewPrepExecuted} />
            </MetricSection>

            <MetricSection title="求人">
              <MetricRow label="求人検索" value={m.jobSearched} />
              <MetricRow label="求人紹介" value={m.jobIntroduced} sub={`紹介率 ${pct(m.jobIntroductionRate)}`} />
            </MetricSection>

            <MetricSection title="エントリー〜承諾">
              <MetricRow label="エントリー" value={m.entry.count} sub={`エントリー率 ${pct(m.entry.rate)}`} />
              <MetricRow label="書類通過" value={m.documentPass.count} sub={`通過率 ${pct(m.documentPass.rate)}`} />
              <MetricRow label="内定" value={m.offer.count} sub={`内定率 ${pct(m.offer.rate)}`} />
              <MetricRow label="承諾" value={m.acceptance.count} sub={`承諾率 ${pct(m.acceptance.rate)}`} />
            </MetricSection>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-[#9CA3AF] mb-1">{title}</div>
      <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-[#F3F4F6]">
        {children}
      </div>
    </div>
  );
}

function MetricRow({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 text-[11px]">
      <span className="text-[#6B7280]">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="text-[13px] font-semibold text-[#374151] tabular-nums">{value}</span>
        {sub && <span className="text-[10px] text-[#9CA3AF] tabular-nums">{sub}</span>}
      </span>
    </div>
  );
}
