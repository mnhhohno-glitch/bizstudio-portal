"use client";

// T-071 実績表（FileMaker 形）：起算日から 5 週の週マトリクス（4タブ）＋直近6ヶ月コホート（1タブ）。
// - 上部：担当セレクト／起算日ピッカー／目標登録ボタン（T-073）。
// - 週マトリクス：GET /api/performance/weekly（実績＋目標＋TOTAL＋達成率）。
// - 直近6ヶ月：GET /api/performance/cohort（コホート追跡の率）。
// 既存の期間ボタン式は廃止。集計の数え方は API 側（変更なし）。

import { useState, useEffect, useCallback, useMemo } from "react";
import TargetModal from "./TargetModal";

type Advisor = { id: string; name: string };
type CUP = { recs: number; uniq: number; perPerson: number | null };
type WeeklyMatrix = {
  interview: { first: number; second: number; thirdPlus: number; total: number };
  proposal: { fresh: CUP; existing: CUP; total: CUP };
  entry: { fresh: CUP; existing: CUP; total: CUP };
  selection: { documentPass: number; offer: number; acceptance: number; decidedRevenue: number | null; decidedUnitPrice: number | null };
};
type TKey = "interviewFirst" | "proposalUniq" | "entryUniq" | "documentPass" | "offer" | "acceptance";
type ColOut = { index: number; label: string; subLabel: string | null; from: string; to: string; businessDays: number; matrix: WeeklyMatrix; targets: Record<TKey, number | null> };
type Granularity = "day" | "week" | "month";
type WeeklyResp = {
  granularity: Granularity;
  columns: ColOut[];
  total: { from: string; to: string; matrix: WeeklyMatrix; targets: Record<TKey, number | null>; achievement: Record<TKey, number | null> };
  targetExists: boolean;
};
type Cohort = { yearMonth: string; entry: number; documentPass: number; offer: number; acceptance: number; documentPassRate: number | null; offerRate: number | null; acceptanceRate: number | null };

const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: "day", label: "日" },
  { key: "week", label: "週" },
  { key: "month", label: "半年" },
];

const TABS = [
  { key: "interview", label: "面談実績" },
  { key: "proposal", label: "求人紹介実績" },
  { key: "entry", label: "エントリー実績" },
  { key: "selection", label: "選考状況" },
  { key: "cohort", label: "直近6ヶ月" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function todayJst(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}
const numFmt = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));
const pctFmt = (r: number | null | undefined) => (r == null ? "—" : `${(r * 100).toFixed(1)}%`);
const yenFmt = (v: number | null | undefined) => (v == null ? "—" : `¥${Math.round(v).toLocaleString()}`);
const mdLabel = (d: string) => { const [, m, day] = d.split("-"); return `${parseInt(m)}/${parseInt(day)}`; };

// 行定義：actual 抽出関数＋任意 targetKey＋フォーマッタ
type Row = {
  label: string;
  indent?: boolean;
  actual: (m: WeeklyMatrix) => number | null;
  targetKey?: TKey;
  fmt?: (v: number | null) => string;
};

const ROWS: Record<Exclude<TabKey, "cohort">, Row[]> = {
  interview: [
    { label: "初回面談", actual: (m) => m.interview.first, targetKey: "interviewFirst" },
    { label: "求人面談（2回目）", actual: (m) => m.interview.second },
    { label: "既存面談（3回目以降）", actual: (m) => m.interview.thirdPlus },
    { label: "合計面談", actual: (m) => m.interview.total },
  ],
  proposal: [
    { label: "初回提案 人数", actual: (m) => m.proposal.fresh.uniq },
    { label: "初回提案 件数", indent: true, actual: (m) => m.proposal.fresh.recs },
    { label: "初回提案 1人当たり", indent: true, actual: (m) => m.proposal.fresh.perPerson, fmt: (v) => numFmt(v, 1) },
    { label: "既存提案 人数", actual: (m) => m.proposal.existing.uniq },
    { label: "既存提案 件数", indent: true, actual: (m) => m.proposal.existing.recs },
    { label: "既存提案 1人当たり", indent: true, actual: (m) => m.proposal.existing.perPerson, fmt: (v) => numFmt(v, 1) },
    { label: "合計提案 人数", actual: (m) => m.proposal.total.uniq, targetKey: "proposalUniq" },
    { label: "合計提案 件数", indent: true, actual: (m) => m.proposal.total.recs },
    { label: "合計提案 1人当たり", indent: true, actual: (m) => m.proposal.total.perPerson, fmt: (v) => numFmt(v, 1) },
  ],
  entry: [
    { label: "新規エントリー 人数", actual: (m) => m.entry.fresh.uniq },
    { label: "新規エントリー 件数", indent: true, actual: (m) => m.entry.fresh.recs },
    { label: "新規エントリー 1人当たり", indent: true, actual: (m) => m.entry.fresh.perPerson, fmt: (v) => numFmt(v, 1) },
    { label: "既存エントリー 人数", actual: (m) => m.entry.existing.uniq },
    { label: "既存エントリー 件数", indent: true, actual: (m) => m.entry.existing.recs },
    { label: "既存エントリー 1人当たり", indent: true, actual: (m) => m.entry.existing.perPerson, fmt: (v) => numFmt(v, 1) },
    { label: "合計エントリー 人数", actual: (m) => m.entry.total.uniq, targetKey: "entryUniq" },
    { label: "合計エントリー 件数", indent: true, actual: (m) => m.entry.total.recs },
    { label: "合計エントリー 1人当たり", indent: true, actual: (m) => m.entry.total.perPerson, fmt: (v) => numFmt(v, 1) },
  ],
  selection: [
    { label: "書類通過", actual: (m) => m.selection.documentPass, targetKey: "documentPass" },
    { label: "内定", actual: (m) => m.selection.offer, targetKey: "offer" },
    { label: "承諾", actual: (m) => m.selection.acceptance, targetKey: "acceptance" },
    { label: "決定売上", actual: (m) => m.selection.decidedRevenue, fmt: yenFmt },
    { label: "決定単価", actual: (m) => m.selection.decidedUnitPrice, fmt: yenFmt },
  ],
};

export default function PerformancePanel() {
  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [anchorDate, setAnchorDate] = useState<string>(() => todayJst());
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [tab, setTab] = useState<TabKey>("entry");
  const [weekly, setWeekly] = useState<WeeklyResp | null>(null);
  const [cohorts, setCohorts] = useState<Cohort[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTargetModal, setShowTargetModal] = useState(false);

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

  const fetchWeekly = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/performance/weekly?employeeId=${employeeId}&anchorDate=${anchorDate}&granularity=${granularity}`);
      if (res.ok) setWeekly(await res.json());
    } catch { /* */ } finally { setLoading(false); }
  }, [employeeId, anchorDate, granularity]);

  const fetchCohort = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/performance/cohort?employeeId=${employeeId}&months=6`);
      if (res.ok) setCohorts((await res.json()).cohorts ?? null);
    } catch { /* */ } finally { setLoading(false); }
  }, [employeeId]);

  useEffect(() => {
    if (tab === "cohort") void fetchCohort();
    else void fetchWeekly();
  }, [tab, fetchWeekly, fetchCohort]);

  const advisorName = useMemo(() => advisors.find((a) => a.id === employeeId)?.name ?? "", [advisors, employeeId]);

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] overflow-hidden">
      {/* ヘッダ */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#E5E7EB] flex-wrap">
        <h2 className="text-[14px] font-medium text-[#374151] shrink-0">📊 実績表</h2>
        <select
          value={employeeId ?? ""}
          onChange={(e) => setEmployeeId(e.target.value || null)}
          className="text-[12px] border border-gray-200 rounded px-2 py-1 bg-white focus:ring-1 focus:ring-[#2563EB] max-w-[140px]"
        >
          {advisors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <label className="text-[11px] text-[#6B7280] ml-1">起算日</label>
        <input
          type="date"
          value={anchorDate}
          onChange={(e) => setAnchorDate(e.target.value)}
          className="text-[12px] border border-gray-200 rounded px-2 py-1"
        />
        {/* 粒度切替（cohort タブ以外で有効） */}
        <div className="flex gap-0.5 ml-1">
          {GRANULARITIES.map((g) => (
            <button
              key={g.key}
              onClick={() => setGranularity(g.key)}
              disabled={tab === "cohort"}
              className={`px-2 py-1 text-[12px] rounded border transition-colors disabled:opacity-40 ${
                granularity === g.key ? "bg-[#374151] text-white border-[#374151]" : "border-gray-200 text-[#6B7280] hover:bg-gray-50"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowTargetModal(true)}
          disabled={!employeeId}
          className="text-[12px] border border-[#2563EB] text-[#2563EB] rounded px-2 py-1 hover:bg-blue-50 disabled:opacity-50 ml-auto"
        >
          🎯 目標登録
        </button>
      </div>

      {showTargetModal && employeeId && (
        <TargetModal
          isOpen={showTargetModal}
          onClose={() => setShowTargetModal(false)}
          employeeId={employeeId}
          employeeName={advisorName}
          yearMonth={anchorDate.slice(0, 7)}
        />
      )}

      {/* タブ */}
      <div className="flex gap-1 px-3 py-2 border-b border-[#F3F4F6] flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-2.5 py-1 text-[12px] rounded-md border transition-colors ${
              tab === t.key ? "bg-[#2563EB] text-white border-[#2563EB]" : "border-gray-200 text-[#6B7280] hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 本体 */}
      <div className="px-4 py-3 overflow-x-auto">
        {loading ? (
          <div className="py-8 text-center text-[12px] text-[#9CA3AF]">読み込み中...</div>
        ) : tab === "cohort" ? (
          <CohortTable cohorts={cohorts} />
        ) : (
          <WeekMatrixTable weekly={weekly} rows={ROWS[tab]} />
        )}
      </div>
    </div>
  );
}

function WeekMatrixTable({ weekly, rows }: { weekly: WeeklyResp | null; rows: Row[] }) {
  if (!weekly) return <div className="py-8 text-center text-[12px] text-[#9CA3AF]">データなし</div>;
  const { columns, total } = weekly;
  const fmt = (r: Row, v: number | null) => (r.fmt ? r.fmt(v) : numFmt(v));

  return (
    <table className="w-full text-[13px] border-collapse">
      <thead>
        <tr className="text-[#6B7280]">
          <th className="sticky left-0 bg-white px-3 py-2.5 text-left font-medium border-b border-gray-200 min-w-[200px]">段階</th>
          {columns.map((c) => (
            <th key={c.index} className="px-3 py-2.5 text-center font-medium border-b border-gray-200 whitespace-nowrap">
              {c.label}
              <div className="text-[11px] text-[#9CA3AF]">{c.subLabel ?? `${mdLabel(c.from)}〜${mdLabel(c.to)}`}</div>
              <div className="text-[10px] text-[#C0C4CC]">目標｜実績</div>
            </th>
          ))}
          <th className="px-3 py-2.5 text-center font-medium border-b border-gray-200 bg-[#F9FAFB] whitespace-nowrap">合計<div className="text-[10px] text-[#C0C4CC]">目標｜実績</div></th>
          <th className="px-3 py-2.5 text-center font-medium border-b border-gray-200 whitespace-nowrap min-w-[80px]">達成率</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#F3F4F6]">
        {rows.map((r) => {
          const hasTarget = !!r.targetKey;
          return (
            <tr key={r.label} className="hover:bg-[#F9FAFB]">
              <td className={`sticky left-0 bg-white px-3 py-2 text-[#374151] ${r.indent ? "pl-7 text-[#9CA3AF] text-[12px]" : "font-medium"}`}>{r.label}</td>
              {columns.map((c) => {
                const a = r.actual(c.matrix);
                const tgt = hasTarget ? c.targets[r.targetKey!] : null;
                return (
                  <td key={c.index} className="px-3 py-2 text-center tabular-nums">
                    {hasTarget && <span className="text-[#9CA3AF]">{numFmt(tgt, 1)}｜</span>}
                    <span className="text-[#374151] font-medium">{fmt(r, a)}</span>
                  </td>
                );
              })}
              <td className="px-3 py-2 text-center tabular-nums bg-[#F9FAFB]">
                {hasTarget && <span className="text-[#9CA3AF]">{numFmt(total.targets[r.targetKey!], 1)}｜</span>}
                <span className="text-[#374151] font-semibold">{fmt(r, r.actual(total.matrix))}</span>
              </td>
              <td className="px-3 py-2 text-center tabular-nums">
                {hasTarget ? <span className="text-[#2563EB] font-medium">{pctFmt(total.achievement[r.targetKey!])}</span> : <span className="text-[#C0C4CC]">—</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CohortTable({ cohorts }: { cohorts: Cohort[] | null }) {
  if (!cohorts || cohorts.length === 0) return <div className="py-8 text-center text-[12px] text-[#9CA3AF]">データなし</div>;
  return (
    <table className="w-full text-[13px] border-collapse">
      <thead>
        <tr className="text-[#6B7280]">
          <th className="sticky left-0 bg-white px-3 py-2.5 text-left font-medium border-b border-gray-200 min-w-[180px]">段階</th>
          {cohorts.map((c) => (
            <th key={c.yearMonth} className="px-3 py-2.5 text-center font-medium border-b border-gray-200 whitespace-nowrap">{c.yearMonth}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-[#F3F4F6]">
        <tr className="hover:bg-[#F9FAFB]">
          <td className="sticky left-0 bg-white px-3 py-2 font-medium text-[#374151]">エントリー（人数）</td>
          {cohorts.map((c) => <td key={c.yearMonth} className="px-3 py-2 text-center tabular-nums font-medium">{c.entry}</td>)}
        </tr>
        {([
          ["書類通過", "documentPass", "documentPassRate"],
          ["内定", "offer", "offerRate"],
          ["承諾", "acceptance", "acceptanceRate"],
        ] as const).map(([label, cntKey, rateKey]) => (
          <tr key={label} className="hover:bg-[#F9FAFB]">
            <td className="sticky left-0 bg-white px-3 py-2 font-medium text-[#374151]">{label}</td>
            {cohorts.map((c) => (
              <td key={c.yearMonth} className="px-3 py-2 text-center tabular-nums">
                <div className="text-[#374151] font-medium">{c[cntKey] as number}</div>
                <div className="text-[11px] text-[#2563EB]">{pctFmt(c[rateKey] as number | null)}</div>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
