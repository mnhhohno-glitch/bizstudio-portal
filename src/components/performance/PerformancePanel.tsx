"use client";

// T-071 実績表（FileMaker 形）：起算日から 5 週の週マトリクス（4タブ）＋直近6ヶ月コホート（1タブ）。
// - 上部：担当セレクト／起算日ピッカー／目標登録ボタン（T-073）。
// - 週マトリクス：GET /api/performance/weekly（実績＋目標＋TOTAL＋達成率）。
// - 直近6ヶ月：GET /api/performance/cohort（コホート追跡の率）。
// 既存の期間ボタン式は廃止。集計の数え方は API 側（変更なし）。

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
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
  total: { from: string; to: string; matrix: WeeklyMatrix; targets: Record<TKey, number | null>; achievement: Record<TKey, number | null>; interviewRanks?: Record<string, number> };
  targetExists: boolean;
};
type Cohort = {
  yearMonth: string;
  interview: { first: number; second: number; thirdPlus: number; total: number };
  proposal: { fresh: number; existing: number; total: number };
  entry: { fresh: number; existing: number; total: number };
  documentPass: number; offer: number; decided: number;
  documentPassRate: number | null; offerRate: number | null; decidedRate: number | null;
  decidedRevenue: number | null; decidedUnitPrice: number | null;
};
// T-071 ③ 合計列・平均列。Cohort と shape は同じ（yearMonth なし、数値は小数を含む）。
type CohortSummary = Omit<Cohort, "yearMonth">;
type CohortResp = { cohorts: Cohort[]; total: CohortSummary; average: CohortSummary };
type DetailRow = Record<string, string | number | null>;
type DetailResp = { tab: string; stage?: string | null; summary: { persons: number; records: number }; rows: DetailRow[] };
// 当月実績：週マトリクス（weekly 互換）＋ 当月初回面談者の属性分布（円グラフ用）。
type Attr = Record<string, number>;
type MonthlyResp = WeeklyResp & { attributes: { total: number; rank: Attr; gender: Attr; jobType: Attr; ageBand: Attr } };

// UI ラベルのみ付け替え（内部値 day/week/month はロジック対応を崩さないため変更しない）。
//   day（起算日から5日）→「週」、week（5週）→「月」、month（6ヶ月）→「半年」。
const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: "day", label: "週" },
  { key: "week", label: "月" },
  { key: "month", label: "半年" },
];

const TABS = [
  { key: "monthly", label: "当月実績" },
  { key: "interview", label: "面談実績" },
  { key: "proposal", label: "求人紹介実績" },
  { key: "entry", label: "エントリー実績" },
  { key: "selection", label: "選考状況" },
  { key: "cohort", label: "直近6ヶ月" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
// 表・グラフ非連動タブ（明細・粒度・週マトリクスを使わない）
type NonMatrixTab = "cohort" | "monthly";

function todayJst(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}
const numFmt = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));
const pctFmt = (r: number | null | undefined) => (r == null ? "—" : `${(r * 100).toFixed(1)}%`);
const yenFmt = (v: number | null | undefined) => (v == null ? "—" : `¥${Math.round(v).toLocaleString()}`);
const mdLabel = (d: string) => { const [, m, day] = d.split("-"); return `${parseInt(m)}/${parseInt(day)}`; };

// 行定義：actual 抽出関数＋任意 targetKey＋フォーマッタ。
// band＝薄青の帯色（提案/エントリーの人数行のみ）。isTotal＝合計行（上罫線＋太字）。
type Row = {
  label: string;
  indent?: boolean;
  // 帯色：true=薄青(#EFF6FF、提案/エントリー人数の補助強調)、"orange"=薄オレンジ(#FFF4E6、合計・決定の強調・直近6ヶ月と統一)。
  band?: boolean | "orange";
  isTotal?: boolean;
  actual: (m: WeeklyMatrix) => number | null;
  targetKey?: TKey;
  fmt?: (v: number | null) => string;
};

// 当月実績タブの行（直近6ヶ月と同項目＝人数のみ）。
// 帯色ルール（直近6ヶ月と統一）：**合計面談・合計提案・合計エントリー・決定の4行のみ薄オレンジ**。他は白。
const MONTHLY_ROWS: Row[] = [
  { label: "初回面談", actual: (m) => m.interview.first, targetKey: "interviewFirst" },
  { label: "求人面談（2回目）", actual: (m) => m.interview.second },
  { label: "既存面談（3回目以降）", actual: (m) => m.interview.thirdPlus },
  { label: "合計面談", band: "orange", isTotal: true, actual: (m) => m.interview.total },
  { label: "初回提案", actual: (m) => m.proposal.fresh.uniq },
  { label: "既存提案", actual: (m) => m.proposal.existing.uniq },
  { label: "合計提案", band: "orange", isTotal: true, actual: (m) => m.proposal.total.uniq, targetKey: "proposalUniq" },
  { label: "新規エントリー", actual: (m) => m.entry.fresh.uniq },
  { label: "既存エントリー", actual: (m) => m.entry.existing.uniq },
  { label: "合計エントリー", band: "orange", isTotal: true, actual: (m) => m.entry.total.uniq, targetKey: "entryUniq" },
  { label: "書類通過", actual: (m) => m.selection.documentPass, targetKey: "documentPass" },
  { label: "内定", actual: (m) => m.selection.offer, targetKey: "offer" },
  { label: "決定", band: "orange", actual: (m) => m.selection.acceptance, targetKey: "acceptance" },
  { label: "決定売上", actual: (m) => m.selection.decidedRevenue, fmt: yenFmt },
  { label: "売上単価", actual: (m) => m.selection.decidedUnitPrice, fmt: yenFmt },
];

const ROWS: Record<Exclude<TabKey, NonMatrixTab>, Row[]> = {
  // 面談：色なし。合計面談は上罫線＋太字で区別。
  interview: [
    { label: "初回面談", actual: (m) => m.interview.first, targetKey: "interviewFirst" },
    { label: "求人面談（2回目）", actual: (m) => m.interview.second },
    { label: "既存面談（3回目以降）", actual: (m) => m.interview.thirdPlus },
    { label: "合計面談", isTotal: true, actual: (m) => m.interview.total },
  ],
  // 求人紹介：人数行に帯色。
  proposal: [
    { label: "初回提案 人数", band: true, actual: (m) => m.proposal.fresh.uniq },
    { label: "初回提案 件数", indent: true, actual: (m) => m.proposal.fresh.recs },
    { label: "初回提案 1人当たり", indent: true, actual: (m) => m.proposal.fresh.perPerson, fmt: (v) => numFmt(v, 1) },
    { label: "既存提案 人数", band: true, actual: (m) => m.proposal.existing.uniq },
    { label: "既存提案 件数", indent: true, actual: (m) => m.proposal.existing.recs },
    { label: "既存提案 1人当たり", indent: true, actual: (m) => m.proposal.existing.perPerson, fmt: (v) => numFmt(v, 1) },
    { label: "合計提案 人数", band: true, isTotal: true, actual: (m) => m.proposal.total.uniq, targetKey: "proposalUniq" },
    { label: "合計提案 件数", indent: true, actual: (m) => m.proposal.total.recs },
    { label: "合計提案 1人当たり", indent: true, actual: (m) => m.proposal.total.perPerson, fmt: (v) => numFmt(v, 1) },
  ],
  // エントリー：人数行に帯色。
  entry: [
    { label: "新規エントリー 人数", band: true, actual: (m) => m.entry.fresh.uniq },
    { label: "新規エントリー 件数", indent: true, actual: (m) => m.entry.fresh.recs },
    { label: "新規エントリー 1人当たり", indent: true, actual: (m) => m.entry.fresh.perPerson, fmt: (v) => numFmt(v, 1) },
    { label: "既存エントリー 人数", band: true, actual: (m) => m.entry.existing.uniq },
    { label: "既存エントリー 件数", indent: true, actual: (m) => m.entry.existing.recs },
    { label: "既存エントリー 1人当たり", indent: true, actual: (m) => m.entry.existing.perPerson, fmt: (v) => numFmt(v, 1) },
    { label: "合計エントリー 人数", band: true, isTotal: true, actual: (m) => m.entry.total.uniq, targetKey: "entryUniq" },
    { label: "合計エントリー 件数", indent: true, actual: (m) => m.entry.total.recs },
    { label: "合計エントリー 1人当たり", indent: true, actual: (m) => m.entry.total.perPerson, fmt: (v) => numFmt(v, 1) },
  ],
  // 選考状況：色なし。
  selection: [
    { label: "書類通過", actual: (m) => m.selection.documentPass, targetKey: "documentPass" },
    { label: "内定", actual: (m) => m.selection.offer, targetKey: "offer" },
    { label: "承諾", actual: (m) => m.selection.acceptance, targetKey: "acceptance" },
    { label: "決定売上", actual: (m) => m.selection.decidedRevenue, fmt: yenFmt },
    { label: "決定単価", actual: (m) => m.selection.decidedUnitPrice, fmt: yenFmt },
  ],
};

// ダークグレーのヘッダ用クラス。
const HEAD_CLS = "bg-[#3C3C3C] text-white";
const SUBHEAD_CLS = "text-[#D1D5DB]"; // 目標｜実績 等のサブ文字

export default function PerformancePanel() {
  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [anchorDate, setAnchorDate] = useState<string>(() => todayJst());
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [tab, setTab] = useState<TabKey>("monthly");
  const [weekly, setWeekly] = useState<WeeklyResp | null>(null);
  const [monthly, setMonthly] = useState<MonthlyResp | null>(null);
  const [cohorts, setCohorts] = useState<Cohort[] | null>(null);
  // T-071 ③ 合計・平均（6ヶ月通算ユニーク／各月平均）。
  const [cohortTotal, setCohortTotal] = useState<CohortSummary | null>(null);
  const [cohortAverage, setCohortAverage] = useState<CohortSummary | null>(null);
  const [selectionStage, setSelectionStage] = useState<"documentPass" | "offer" | "acceptance">("documentPass");
  const [detail, setDetail] = useState<DetailResp | null>(null);
  const [showDetail, setShowDetail] = useState(false);
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
      if (res.ok) {
        const data = (await res.json()) as CohortResp;
        setCohorts(data.cohorts ?? null);
        setCohortTotal(data.total ?? null);
        setCohortAverage(data.average ?? null);
      }
    } catch { /* */ } finally { setLoading(false); }
  }, [employeeId]);

  const fetchMonthly = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/performance/monthly?employeeId=${employeeId}&anchorDate=${anchorDate}`);
      if (res.ok) setMonthly(await res.json());
    } catch { /* */ } finally { setLoading(false); }
  }, [employeeId, anchorDate]);

  // 明細（マトリクスタブ連動）。選考状況は selectionStage サブタブで段階を指定。当月実績・直近6ヶ月は明細なし。
  const fetchDetail = useCallback(async () => {
    if (!employeeId || tab === "cohort" || tab === "monthly") { setDetail(null); return; }
    try {
      const params = new URLSearchParams({ employeeId, anchorDate, granularity, tab });
      if (tab === "selection") params.set("stage", selectionStage);
      const res = await fetch(`/api/performance/detail?${params.toString()}`);
      if (res.ok) setDetail(await res.json());
    } catch { /* */ }
  }, [employeeId, anchorDate, granularity, tab, selectionStage]);

  useEffect(() => {
    if (tab === "cohort") void fetchCohort();
    else if (tab === "monthly") void fetchMonthly();
    else void fetchWeekly();
  }, [tab, fetchWeekly, fetchCohort, fetchMonthly]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

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
          <option value="all">全員</option>
          {advisors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <label className="text-[11px] text-[#6B7280] ml-1">起算日</label>
        <input
          type="date"
          value={anchorDate}
          onChange={(e) => setAnchorDate(e.target.value)}
          className="text-[12px] border border-gray-200 rounded px-2 py-1"
        />
        {/* 粒度切替（cohort・当月実績タブ以外で有効） */}
        <div className="flex gap-0.5 ml-1">
          {GRANULARITIES.map((g) => (
            <button
              key={g.key}
              onClick={() => setGranularity(g.key)}
              disabled={tab === "cohort" || tab === "monthly"}
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
          className="w-[112px] text-center text-[12px] border border-[#2563EB] text-[#2563EB] rounded px-2.5 py-1 hover:bg-blue-50 disabled:opacity-50 ml-auto"
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
            className={`w-[112px] text-center px-2.5 py-1 text-[12px] rounded-md border transition-colors ${
              tab === t.key ? "bg-[#2563EB] text-white border-[#2563EB]" : "border-gray-200 text-[#6B7280] hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* マトリクス本体 */}
      <div className="px-4 py-3 overflow-x-auto">
        {loading ? (
          <div className="py-8 text-center text-[12px] text-[#9CA3AF]">読み込み中...</div>
        ) : tab === "cohort" ? (
          <CohortTable cohorts={cohorts} total={cohortTotal} average={cohortAverage} />
        ) : tab === "monthly" ? (
          <WeekMatrixTable weekly={monthly} rows={MONTHLY_ROWS} />
        ) : (
          <WeekMatrixTable weekly={weekly} rows={ROWS[tab as Exclude<TabKey, NonMatrixTab>]} />
        )}
      </div>

      {/* グラフ（面談実績タブのみ常設：左＝折れ線・右＝円） */}
      {tab === "interview" && !loading && <InterviewCharts weekly={weekly} />}

      {/* 当月実績タブ：週別折れ線＋属性円4種 */}
      {tab === "monthly" && !loading && monthly && <MonthlyCharts data={monthly} />}

      {/* 明細を見るボタン（マトリクスタブ連動。cohort・当月実績は対象外）→ ポップアップ */}
      {tab !== "cohort" && tab !== "monthly" && (
        <div className="border-t border-[#E5E7EB] px-4 py-3">
          <button
            onClick={() => setShowDetail(true)}
            disabled={!detail}
            className="text-[12px] border border-[#2563EB] text-[#2563EB] rounded px-3 py-1.5 hover:bg-blue-50 disabled:opacity-50"
          >
            📋 明細を見る{detail ? `（${detail.summary.persons} 人 / ${detail.summary.records} 件）` : ""}
          </button>
        </div>
      )}

      {/* 明細ポップアップ（sticky ヘッダ＋スクロール） */}
      {showDetail && tab !== "cohort" && tab !== "monthly" && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setShowDetail(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="pointer-events-auto bg-white rounded-xl shadow-2xl w-full max-w-[1400px] max-h-[85vh] flex flex-col overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-200 bg-[#3C3C3C] text-white">
                <h2 className="text-[14px] font-semibold shrink-0">明細一覧</h2>
                {tab === "selection" && (
                  <div className="flex gap-1 w-[360px]">
                    {([["documentPass", "書類選考"], ["offer", "内定"], ["acceptance", "承諾"]] as const).map(([k, l]) => (
                      <button
                        key={k}
                        onClick={() => setSelectionStage(k)}
                        className={`flex-1 px-2 py-1 text-[12px] rounded border transition-colors ${
                          selectionStage === k ? "bg-[#2563EB] text-white border-[#2563EB]" : "border-[#6B7280] text-[#D1D5DB] hover:bg-[#4A4A4A]"
                        }`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                )}
                {detail && (
                  <span className="text-[12px] text-[#D1D5DB] ml-auto">
                    対象 <span className="font-semibold text-white">{detail.summary.persons}</span> 人 / {detail.summary.records} 件
                  </span>
                )}
                <button onClick={() => setShowDetail(false)} className="text-white hover:text-gray-300 text-lg px-1">✕</button>
              </div>
              {/* 15 行相当（≈480px）で頭打ち、超過はスクロール。thead は sticky。 */}
              <div className="overflow-auto max-h-[480px]">
                <DetailTable tab={tab} detail={detail} />
              </div>
            </div>
          </div>
        </>
      )}
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
        <tr>
          <th className={`sticky left-0 ${HEAD_CLS} px-3 py-2.5 text-left font-medium min-w-[200px]`}>段階</th>
          {columns.map((c) => (
            <th key={c.index} className={`${HEAD_CLS} px-3 py-2.5 text-center font-medium whitespace-nowrap`}>
              {c.label}
              <div className={`text-[11px] ${SUBHEAD_CLS}`}>{c.subLabel ?? `${mdLabel(c.from)}〜${mdLabel(c.to)}`}</div>
              <div className={`text-[10px] ${SUBHEAD_CLS}`}>目標｜実績</div>
            </th>
          ))}
          <th className={`${HEAD_CLS} px-3 py-2.5 text-center font-medium whitespace-nowrap`}>合計<div className={`text-[10px] ${SUBHEAD_CLS}`}>目標｜実績</div></th>
          <th className={`${HEAD_CLS} px-3 py-2.5 text-center font-medium whitespace-nowrap min-w-[70px]`}>平均<div className={`text-[10px] ${SUBHEAD_CLS}`}>/列</div></th>
          <th className={`${HEAD_CLS} px-3 py-2.5 text-center font-medium whitespace-nowrap min-w-[80px]`}>達成率</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#F3F4F6]">
        {rows.map((r) => {
          const hasTarget = !!r.targetKey;
          const totalActual = r.actual(total.matrix);
          // 平均＝TOTAL実績÷列数（粒度で 5 or 6）。実績ベースの平均。
          const avg = totalActual == null || columns.length === 0 ? null : totalActual / columns.length;
          // 帯色（提案/エントリーの人数行のみ）。合計行は上罫線＋太字。
          const rowBg = r.band === "orange" ? "bg-[#FFF4E6]" : r.band ? "bg-[#EFF6FF]" : "bg-white";
          const totalCls = r.isTotal ? "border-t-2 border-[#9CA3AF] font-semibold" : "";
          return (
            <tr key={r.label} className={`${rowBg} ${totalCls} hover:bg-[#E0EAFF]`}>
              <td className={`sticky left-0 ${rowBg} px-3 py-2 text-[#374151] ${r.indent ? "pl-7 text-[#9CA3AF] text-[12px]" : "font-medium"}`}>{r.label}</td>
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
              <td className="px-3 py-2 text-center tabular-nums">
                {hasTarget && <span className="text-[#9CA3AF]">{numFmt(total.targets[r.targetKey!], 1)}｜</span>}
                <span className="text-[#374151] font-semibold">{fmt(r, totalActual)}</span>
              </td>
              <td className="px-3 py-2 text-center tabular-nums text-[#6B7280]">
                {r.fmt ? r.fmt(avg) : numFmt(avg, 1)}
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

// 直近6ヶ月の行定義。num＝人数（or 金額）、pct＝その月の%（構成比 or コホート率、null は非表示）。
// CohortLike = Cohort（月別）も CohortSummary（合計/平均）も受け取れる。
type CohortLike = Omit<Cohort, "yearMonth">;
type CohortRow = {
  label: string;
  num: (c: CohortLike) => number | null;
  pct: (c: CohortLike) => number | null;
  fmt?: (v: number | null) => string;
  band?: "blue" | "orange"; // 合計＝オレンジ、売上系＝オレンジ
  isTotal?: boolean;
};
const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

const COHORT_ROWS: CohortRow[] = [
  { label: "初回面談", num: (c) => c.interview.first, pct: (c) => ratio(c.interview.first, c.interview.total) },
  { label: "求人面談（2回目）", num: (c) => c.interview.second, pct: (c) => ratio(c.interview.second, c.interview.total) },
  { label: "既存面談（3回目以降）", num: (c) => c.interview.thirdPlus, pct: (c) => ratio(c.interview.thirdPlus, c.interview.total) },
  { label: "合計面談", num: (c) => c.interview.total, pct: (c) => (c.interview.total > 0 ? 1 : null), band: "orange", isTotal: true },
  { label: "初回求人紹介", num: (c) => c.proposal.fresh, pct: (c) => ratio(c.proposal.fresh, c.proposal.total) },
  { label: "既存求人紹介", num: (c) => c.proposal.existing, pct: (c) => ratio(c.proposal.existing, c.proposal.total) },
  { label: "合計求人紹介", num: (c) => c.proposal.total, pct: (c) => (c.proposal.total > 0 ? 1 : null), band: "orange", isTotal: true },
  { label: "新規エントリー", num: (c) => c.entry.fresh, pct: (c) => ratio(c.entry.fresh, c.entry.total) },
  { label: "既存エントリー", num: (c) => c.entry.existing, pct: (c) => ratio(c.entry.existing, c.entry.total) },
  { label: "合計エントリー", num: (c) => c.entry.total, pct: (c) => (c.entry.total > 0 ? 1 : null), band: "orange", isTotal: true },
  { label: "書類選考通過", num: (c) => c.documentPass, pct: (c) => c.documentPassRate },
  { label: "内定数", num: (c) => c.offer, pct: (c) => c.offerRate },
  { label: "決定数（内定承諾）", num: (c) => c.decided, pct: (c) => c.decidedRate },
  { label: "決定売上（粗利金額）", num: (c) => c.decidedRevenue, pct: () => null, fmt: yenFmt, band: "orange" },
  { label: "売上単価（1人当単価）", num: (c) => c.decidedUnitPrice, pct: () => null, fmt: yenFmt, band: "orange" },
];

// 合計・平均の数値書式：人数は小数1桁、件数・売上は整数 or 円表記（行ごとの fmt に従う）。
// 既存の cohort セルは numFmt(n) で整数表示だが、合計・平均は小数になり得るため別フォーマッタで桁数を分ける。
const numFmtCell = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(0));
const numFmtAvg = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(1));

function CohortTable({ cohorts, total, average }: { cohorts: Cohort[] | null; total: CohortSummary | null; average: CohortSummary | null }) {
  if (!cohorts || cohorts.length === 0) return <div className="py-8 text-center text-[12px] text-[#9CA3AF]">データなし</div>;
  // T-071 ③ 合計列・平均列を月の後ろに追加。達成率列は作らない。
  return (
    // 段階列＝最長項目名が収まる固定幅（折り返さない）、月6列＋合計＋平均＝残り幅を均等配分、全幅。
    <table className="w-full text-[12px] border-collapse" style={{ tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: "190px" }} />
        {cohorts.map((c) => (
          <Fragment key={c.yearMonth}>
            <col />
            <col />
          </Fragment>
        ))}
        {/* 合計列（実績｜%） */}
        <col />
        <col />
        {/* 平均列（実績｜%） */}
        <col />
        <col />
      </colgroup>
      <thead>
        {/* 1段目：段階列＋各月（colSpan=2）＋合計（colSpan=2）＋平均（colSpan=2） */}
        <tr>
          <th rowSpan={2} className={`sticky left-0 ${HEAD_CLS} px-2 py-1.5 text-left font-medium whitespace-nowrap`}>段階</th>
          {cohorts.map((c) => (
            <th key={c.yearMonth} colSpan={2} className={`${HEAD_CLS} px-2 py-1.5 text-center font-medium whitespace-nowrap border-l border-[#5A5A5A]`}>{c.yearMonth}</th>
          ))}
          <th colSpan={2} className={`${HEAD_CLS} px-2 py-1.5 text-center font-medium whitespace-nowrap border-l-2 border-[#9CA3AF]`}>合計</th>
          <th colSpan={2} className={`${HEAD_CLS} px-2 py-1.5 text-center font-medium whitespace-nowrap border-l border-[#5A5A5A]`}>平均</th>
        </tr>
        {/* 2段目：実績｜% */}
        <tr>
          {cohorts.map((c) => (
            <Fragment key={c.yearMonth}>
              <th className={`${HEAD_CLS} px-2 py-1 text-right font-normal text-[10px] ${SUBHEAD_CLS} border-l border-[#5A5A5A]`}>実績</th>
              <th className={`${HEAD_CLS} px-2 py-1 text-right font-normal text-[10px] ${SUBHEAD_CLS}`}>%</th>
            </Fragment>
          ))}
          <th className={`${HEAD_CLS} px-2 py-1 text-right font-normal text-[10px] ${SUBHEAD_CLS} border-l-2 border-[#9CA3AF]`}>実績</th>
          <th className={`${HEAD_CLS} px-2 py-1 text-right font-normal text-[10px] ${SUBHEAD_CLS}`}>%</th>
          <th className={`${HEAD_CLS} px-2 py-1 text-right font-normal text-[10px] ${SUBHEAD_CLS} border-l border-[#5A5A5A]`}>実績</th>
          <th className={`${HEAD_CLS} px-2 py-1 text-right font-normal text-[10px] ${SUBHEAD_CLS}`}>%</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#F3F4F6]">
        {COHORT_ROWS.map((r) => {
          const rowBg = r.band === "orange" ? "bg-[#FFF4E6]" : r.band === "blue" ? "bg-[#EFF6FF]" : "bg-white";
          const totalCls = r.isTotal ? "border-t-2 border-[#9CA3AF] font-semibold" : "";
          return (
            <tr key={r.label} className={`${rowBg} ${totalCls} hover:bg-[#F3F4F6]`}>
              <td className={`sticky left-0 ${rowBg} px-2 py-1 font-medium text-[#374151] whitespace-nowrap`}>{r.label}</td>
              {cohorts.map((c) => {
                const n = r.num(c);
                const pv = r.pct(c);
                return (
                  <Fragment key={c.yearMonth}>
                    <td className="px-2 py-1 text-right tabular-nums text-[#374151] font-medium border-l border-[#F3F4F6]">{r.fmt ? r.fmt(n) : numFmtCell(n)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-[11px] text-[#2563EB]">{pv != null ? pctFmt(pv) : ""}</td>
                  </Fragment>
                );
              })}
              {/* 合計列：人数は通算ユニーク（API側で COUNT DISTINCT 再集計）、件数・売上は加算、率は通算コホート率。 */}
              {(() => {
                const n = total ? r.num(total) : null;
                const pv = total ? r.pct(total) : null;
                return (
                  <>
                    <td className="px-2 py-1 text-right tabular-nums text-[#374151] font-semibold border-l-2 border-[#9CA3AF]">{r.fmt ? r.fmt(n) : numFmtCell(n)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-[11px] text-[#2563EB]">{pv != null ? pctFmt(pv) : ""}</td>
                  </>
                );
              })()}
              {/* 平均列：各月実績の÷6固定平均。率は平均人数の隣接段比。 */}
              {(() => {
                const n = average ? r.num(average) : null;
                const pv = average ? r.pct(average) : null;
                return (
                  <>
                    <td className="px-2 py-1 text-right tabular-nums text-[#6B7280] border-l border-[#5A5A5A]">{r.fmt ? r.fmt(n) : numFmtAvg(n)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-[11px] text-[#2563EB]">{pv != null ? pctFmt(pv) : ""}</td>
                  </>
                );
              })()}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// 明細テーブル：タブごとに列を出し分ける。FileMaker ④⑤ 踏襲。
// truncate＝省略表示、wide＝広め（求人タイトルは約2倍幅）。
type DetailCol = { key: string; label: string; truncate?: boolean; wide?: boolean };
const DETAIL_COLS: Record<string, DetailCol[]> = {
  entry: [
    { key: "entryDate", label: "エントリー日" },
    { key: "documentPassDate", label: "書類通過日" },
    { key: "firstInterviewDate", label: "一次面接" },
    { key: "finalInterviewDate", label: "最終面接" },
    { key: "caName", label: "担当CA" },
    { key: "candidateNumber", label: "求職者NO" },
    { key: "candidateName", label: "氏名" },
    { key: "genderAge", label: "性別/年齢" },
    { key: "prefecture", label: "都道府県" },
    { key: "entryFlag", label: "フラグ" },
    { key: "entryFlagDetail", label: "詳細" },
    { key: "companyName", label: "企業名", truncate: true },
    { key: "jobTitle", label: "求人タイトル", truncate: true, wide: true },
  ],
  selection: [
    { key: "documentPassDate", label: "書類通過日" },
    { key: "offerDate", label: "内定日" },
    { key: "acceptanceDate", label: "承諾日" },
    { key: "caName", label: "担当CA" },
    { key: "candidateNumber", label: "求職者NO" },
    { key: "candidateName", label: "氏名" },
    { key: "genderAge", label: "性別/年齢" },
    { key: "entryFlag", label: "フラグ" },
    { key: "entryFlagDetail", label: "詳細" },
    { key: "companyName", label: "企業名", truncate: true },
    { key: "jobTitle", label: "求人タイトル", truncate: true, wide: true },
  ],
  interview: [
    { key: "interviewDate", label: "面談日" },
    { key: "interviewType", label: "種別" },
    { key: "interviewCount", label: "回数" },
    { key: "rank", label: "ランク" },
    { key: "resultFlag", label: "結果" },
    { key: "caName", label: "担当CA" },
    { key: "rcName", label: "担当RC" },
    { key: "candidateNumber", label: "求職者NO" },
    { key: "candidateName", label: "氏名" },
    { key: "genderAge", label: "性別/年齢" },
  ],
  proposal: [
    { key: "proposalDate", label: "紹介日" },
    { key: "source", label: "区分" },
    { key: "caName", label: "担当CA" },
    { key: "candidateNumber", label: "求職者NO" },
    { key: "candidateName", label: "氏名" },
    { key: "genderAge", label: "性別/年齢" },
    { key: "companyName", label: "企業名", truncate: true },
    { key: "jobTitle", label: "求人タイトル", truncate: true, wide: true },
  ],
};
const GENDER_LABEL: Record<string, string> = { male: "男", female: "女", other: "他" };

function cellValue(row: DetailRow, key: string): string {
  if (key === "genderAge") {
    const g = row.gender ? GENDER_LABEL[String(row.gender)] ?? String(row.gender) : "";
    const a = row.age != null ? `${row.age}歳` : "";
    return [g, a].filter(Boolean).join(" ") || "—";
  }
  const v = row[key];
  return v == null || v === "" ? "—" : String(v);
}

const DETAIL_FIXED_ROWS = 15; // 面談・選考は常に15行（FileMaker 式・空行で埋める）

function DetailTable({ tab, detail }: { tab: string; detail: DetailResp | null }) {
  const cols = DETAIL_COLS[tab] ?? DETAIL_COLS.entry;
  if (!detail) return <div className="py-6 text-center text-[12px] text-[#9CA3AF]">読み込み中...</div>;

  // 面談・選考タブは常に15行表示（不足分は空行で埋める）。エントリーは行数固定しない。
  const padTo15 = tab === "interview" || tab === "selection";
  const rows = detail.rows;
  const emptyCount = padTo15 ? Math.max(0, DETAIL_FIXED_ROWS - rows.length) : 0;
  const cellCls = (c: DetailCol) =>
    c.wide ? "max-w-[360px] truncate" : c.truncate ? "max-w-[180px] truncate" : "whitespace-nowrap";

  return (
    <table className="w-full text-[12px] border-collapse">
      <thead className="sticky top-0 z-10">
        <tr className="bg-[#3C3C3C] text-white">
          {cols.map((c) => (
            <th key={c.key} className={`px-2 py-2 text-left font-medium whitespace-nowrap ${c.wide ? "min-w-[300px]" : ""}`}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-[#F3F4F6]">
        {rows.length === 0 && !padTo15 && (
          <tr><td colSpan={cols.length} className="py-6 text-center text-[12px] text-[#9CA3AF]">対象がありません</td></tr>
        )}
        {rows.map((row) => (
          <tr key={String(row.id)} className="hover:bg-[#F9FAFB]">
            {cols.map((c) => (
              <td key={c.key} className={`px-2 py-1.5 text-[#374151] ${cellCls(c)}`} title={c.truncate ? cellValue(row, c.key) : undefined}>
                {cellValue(row, c.key)}
              </td>
            ))}
          </tr>
        ))}
        {Array.from({ length: emptyCount }).map((_, i) => (
          <tr key={`empty-${i}`}>
            {cols.map((c) => (
              <td key={c.key} className="px-2 py-1.5 text-transparent select-none">&nbsp;</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ===== 面談タブのグラフ（Chart.js / cdnjs UMD） =====
// 折れ線＝面談数推移（初回/求人/既存・粒度連動の列）。円＝合計面談のランク割合（overallRank）。
// データ源はマトリクスと同じ weekly API（columns[].matrix.interview / total.interviewRanks）。
let chartJsPromise: Promise<void> | null = null;
function loadChartJs(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).Chart) return Promise.resolve();
  if (chartJsPromise) return chartJsPromise;
  chartJsPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Chart.js load failed"));
    document.head.appendChild(s);
  });
  return chartJsPromise;
}

// ランク表示順と色（実データ体系：A+/A/B+/B/C/D＋未評価。S は存在しない）。
const RANK_ORDER = ["A+", "A", "B+", "B", "C", "D", "未評価"];
const RANK_COLORS: Record<string, string> = {
  "A+": "#15803D", A: "#22C55E", "B+": "#0891B2", B: "#2563EB", C: "#F59E0B", D: "#EF4444", 未評価: "#9CA3AF",
};

function InterviewCharts({ weekly }: { weekly: WeeklyResp | null }) {
  const lineRef = useRef<HTMLCanvasElement>(null);
  const pieRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineChart = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pieChart = useRef<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => { loadChartJs().then(() => setReady(true)).catch(() => {}); }, []);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Chart = typeof window !== "undefined" ? (window as any).Chart : null;
    if (!ready || !weekly || !Chart) return;
    const fg = lineRef.current ? getComputedStyle(lineRef.current).color : "#374151";
    const grid = "rgba(148,163,184,0.25)";

    // 折れ線：3系列（初回=青・求人=緑・既存=オレンジ）、横軸＝粒度連動の列ラベル。
    const labels = weekly.columns.map((c) => c.label);
    const mk = (key: "first" | "second" | "thirdPlus") => weekly.columns.map((c) => c.matrix.interview[key]);
    lineChart.current?.destroy();
    if (lineRef.current) {
      lineChart.current = new Chart(lineRef.current, {
        type: "line",
        data: {
          labels,
          datasets: [
            { label: "初回面談", data: mk("first"), borderColor: "#2563EB", backgroundColor: "#2563EB", tension: 0.3 },
            { label: "求人面談(2回目)", data: mk("second"), borderColor: "#22C55E", backgroundColor: "#22C55E", tension: 0.3 },
            { label: "既存面談(3回目〜)", data: mk("thirdPlus"), borderColor: "#F59E0B", backgroundColor: "#F59E0B", tension: 0.3 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: "bottom", labels: { color: fg, boxWidth: 12, font: { size: 11 } } } },
          scales: {
            x: { ticks: { color: fg, font: { size: 11 } }, grid: { color: grid } },
            y: { beginAtZero: true, ticks: { color: fg, precision: 0 }, grid: { color: grid } },
          },
        },
      });
    }

    // 円（ドーナツ）：合計面談のランク割合。合計＝total.matrix.interview.total。
    const ranks = weekly.total.interviewRanks ?? {};
    const present = RANK_ORDER.filter((r) => (ranks[r] ?? 0) > 0);
    const totalN = present.reduce((s, r) => s + ranks[r], 0);
    pieChart.current?.destroy();
    if (pieRef.current && present.length > 0) {
      pieChart.current = new Chart(pieRef.current, {
        type: "doughnut",
        data: { labels: present, datasets: [{ data: present.map((r) => ranks[r]), backgroundColor: present.map((r) => RANK_COLORS[r]), borderWidth: 1, borderColor: "#ffffff" }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: "right", labels: { color: fg, boxWidth: 12, font: { size: 11 } } },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tooltip: { callbacks: { label: (ctx: any) => `${ctx.label}: ${ctx.parsed}件 (${totalN ? ((ctx.parsed / totalN) * 100).toFixed(1) : 0}%)` } },
          },
        },
      });
    }
    return () => { lineChart.current?.destroy(); pieChart.current?.destroy(); lineChart.current = null; pieChart.current = null; };
  }, [ready, weekly]);

  const firstInterview = weekly?.total.matrix.interview.first ?? 0;
  return (
    <div className="border-t border-[#E5E7EB] px-4 py-4">
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-[#374151] mb-2">面談数の推移</div>
          <div className="h-[260px]"><canvas ref={lineRef} /></div>
        </div>
        <div className="w-full lg:w-[360px] shrink-0">
          <div className="text-[12px] font-medium text-[#374151] mb-2">初回面談のランク割合（{firstInterview}件）</div>
          <div className="h-[260px]">
            {firstInterview > 0 ? <canvas ref={pieRef} /> : <div className="h-full flex items-center justify-center text-[12px] text-[#9CA3AF]">データなし</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// 当月実績タブ：週別折れ線（面談/紹介/エントリー）＋ 当月初回面談者の属性円4種。
const GENDER_ORDER = ["female", "male", "other", "未設定"];
const GENDER_LABELS: Record<string, string> = { female: "女", male: "男", other: "その他", 未設定: "未設定" };
const GENDER_COLORS: Record<string, string> = { female: "#EC4899", male: "#3B82F6", other: "#A78BFA", 未設定: "#9CA3AF" };
const AGE_ORDER = ["20代前半", "20代後半", "30代前半", "30代後半", "40代前半", "45歳以上", "不明"];
const AGE_COLORS: Record<string, string> = {
  "20代前半": "#60A5FA", "20代後半": "#3B82F6", "30代前半": "#22C55E", "30代後半": "#16A34A", "40代前半": "#F59E0B", "45歳以上": "#EF4444", 不明: "#9CA3AF",
};
// 職種希望（大分類）用パレット（カテゴリ可変・循環）。未設定はグレー。
const JOBTYPE_PALETTE = ["#2563EB", "#16A34A", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899", "#84CC16", "#F97316", "#14B8A6", "#A855F7"];

function MonthlyCharts({ data }: { data: MonthlyResp }) {
  const barRef = useRef<HTMLCanvasElement>(null);
  const rankRef = useRef<HTMLCanvasElement>(null);
  const genderRef = useRef<HTMLCanvasElement>(null);
  const jobRef = useRef<HTMLCanvasElement>(null);
  const ageRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const charts = useRef<any[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => { loadChartJs().then(() => setReady(true)).catch(() => {}); }, []);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Chart = typeof window !== "undefined" ? (window as any).Chart : null;
    if (!ready || !Chart) return;
    const fg = barRef.current ? getComputedStyle(barRef.current).color : "#374151";
    const grid = "rgba(148,163,184,0.25)";
    charts.current.forEach((c) => c?.destroy());
    charts.current = [];

    // 折れ線：週別 面談/紹介/エントリー数（面談タブの折れ線と同スタイル）。横軸＝週ラベル、3系列。
    if (barRef.current) {
      const labels = data.columns.map((c) => c.label);
      charts.current.push(new Chart(barRef.current, {
        type: "line",
        data: {
          labels,
          datasets: [
            { label: "面談", data: data.columns.map((c) => c.matrix.interview.total), borderColor: "#2563EB", backgroundColor: "#2563EB", tension: 0.3 },
            { label: "紹介", data: data.columns.map((c) => c.matrix.proposal.total.uniq), borderColor: "#22C55E", backgroundColor: "#22C55E", tension: 0.3 },
            { label: "エントリー", data: data.columns.map((c) => c.matrix.entry.total.uniq), borderColor: "#F59E0B", backgroundColor: "#F59E0B", tension: 0.3 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: "bottom", labels: { color: fg, boxWidth: 12, font: { size: 11 } } } },
          scales: {
            x: { ticks: { color: fg, font: { size: 11 } }, grid: { color: grid } },
            y: { beginAtZero: true, ticks: { color: fg, precision: 0 }, grid: { color: grid } },
          },
        },
      }));
    }

    // 円（ドーナツ）共通ビルダー。
    const buildPie = (
      el: HTMLCanvasElement | null, map: Record<string, number>,
      order: string[] | null, colorOf: (k: string, i: number) => string, labelOf: (k: string) => string,
    ) => {
      if (!el) return;
      const keys = (order ? order.filter((k) => (map[k] ?? 0) > 0) : Object.keys(map).filter((k) => map[k] > 0).sort((a, b) => map[b] - map[a]));
      if (keys.length === 0) return;
      const total = keys.reduce((s, k) => s + map[k], 0);
      charts.current.push(new Chart(el, {
        type: "doughnut",
        data: { labels: keys.map(labelOf), datasets: [{ data: keys.map((k) => map[k]), backgroundColor: keys.map((k, i) => colorOf(k, i)), borderWidth: 1, borderColor: "#ffffff" }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: "right", labels: { color: fg, boxWidth: 10, font: { size: 10 } } },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tooltip: { callbacks: { label: (ctx: any) => `${ctx.label}: ${ctx.parsed}件 (${total ? ((ctx.parsed / total) * 100).toFixed(1) : 0}%)` } },
          },
        },
      }));
    };

    buildPie(rankRef.current, data.attributes.rank, RANK_ORDER, (k) => RANK_COLORS[k] ?? "#9CA3AF", (k) => k);
    buildPie(genderRef.current, data.attributes.gender, GENDER_ORDER, (k) => GENDER_COLORS[k] ?? "#9CA3AF", (k) => GENDER_LABELS[k] ?? k);
    buildPie(jobRef.current, data.attributes.jobType, null, (k, i) => (k === "未設定" ? "#9CA3AF" : JOBTYPE_PALETTE[i % JOBTYPE_PALETTE.length]), (k) => k);
    buildPie(ageRef.current, data.attributes.ageBand, AGE_ORDER, (k) => AGE_COLORS[k] ?? "#9CA3AF", (k) => k);

    return () => { charts.current.forEach((c) => c?.destroy()); charts.current = []; };
  }, [ready, data]);

  const n = data.attributes.total;
  const pie = (title: string, ref: { current: HTMLCanvasElement | null }) => (
    <div className="flex-1 min-w-[200px]">
      <div className="text-[12px] font-medium text-[#374151] mb-1">{title}</div>
      <div className="h-[200px]">{n > 0 ? <canvas ref={ref} /> : <div className="h-full flex items-center justify-center text-[12px] text-[#9CA3AF]">データなし</div>}</div>
    </div>
  );

  return (
    <div className="border-t border-[#E5E7EB] px-4 py-4 space-y-5">
      <div>
        <div className="text-[12px] font-medium text-[#374151] mb-2">週別 面談・紹介・エントリー数の推移</div>
        <div className="h-[240px]"><canvas ref={barRef} /></div>
      </div>
      <div>
        <div className="text-[12px] font-medium text-[#374151] mb-2">当月の初回面談者 属性（{n}人）</div>
        <div className="flex flex-wrap gap-4">
          {pie("ランク", rankRef)}
          {pie("男女比", genderRef)}
          {pie("職種希望（第1希望・大分類）", jobRef)}
          {pie("年齢層", ageRef)}
        </div>
      </div>
    </div>
  );
}
