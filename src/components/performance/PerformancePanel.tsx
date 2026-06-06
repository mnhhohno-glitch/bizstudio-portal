"use client";

// T-071 実績表（FileMaker 形）：起算日から 5 週の週マトリクス（4タブ）＋直近6ヶ月コホート（1タブ）。
// - 上部：担当セレクト／起算日ピッカー／目標登録ボタン（T-073）。
// - 週マトリクス：GET /api/performance/weekly（実績＋目標＋TOTAL＋達成率）。
// - 直近6ヶ月：GET /api/performance/cohort（コホート追跡の率）。
// 既存の期間ボタン式は廃止。集計の数え方は API 側（変更なし）。

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
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
type Cohort = {
  yearMonth: string;
  interview: { first: number; second: number; thirdPlus: number; total: number };
  proposal: { fresh: number; existing: number; total: number };
  entry: { fresh: number; existing: number; total: number };
  documentPass: number; offer: number; decided: number;
  documentPassRate: number | null; offerRate: number | null; decidedRate: number | null;
  decidedRevenue: number | null; decidedUnitPrice: number | null;
};
type DetailRow = Record<string, string | number | null>;
type DetailResp = { tab: string; stage?: string | null; summary: { persons: number; records: number }; rows: DetailRow[] };

// UI ラベルのみ付け替え（内部値 day/week/month はロジック対応を崩さないため変更しない）。
//   day（起算日から5日）→「週」、week（5週）→「月」、month（6ヶ月）→「半年」。
const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: "day", label: "週" },
  { key: "week", label: "月" },
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

// 行定義：actual 抽出関数＋任意 targetKey＋フォーマッタ。
// band＝薄青の帯色（提案/エントリーの人数行のみ）。isTotal＝合計行（上罫線＋太字）。
type Row = {
  label: string;
  indent?: boolean;
  band?: boolean;
  isTotal?: boolean;
  actual: (m: WeeklyMatrix) => number | null;
  targetKey?: TKey;
  fmt?: (v: number | null) => string;
};

const ROWS: Record<Exclude<TabKey, "cohort">, Row[]> = {
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
  const [tab, setTab] = useState<TabKey>("entry");
  const [weekly, setWeekly] = useState<WeeklyResp | null>(null);
  const [cohorts, setCohorts] = useState<Cohort[] | null>(null);
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
      if (res.ok) setCohorts((await res.json()).cohorts ?? null);
    } catch { /* */ } finally { setLoading(false); }
  }, [employeeId]);

  // 明細（マトリクスタブ連動）。選考状況は selectionStage サブタブで段階を指定。
  const fetchDetail = useCallback(async () => {
    if (!employeeId || tab === "cohort") { setDetail(null); return; }
    try {
      const params = new URLSearchParams({ employeeId, anchorDate, granularity, tab });
      if (tab === "selection") params.set("stage", selectionStage);
      const res = await fetch(`/api/performance/detail?${params.toString()}`);
      if (res.ok) setDetail(await res.json());
    } catch { /* */ }
  }, [employeeId, anchorDate, granularity, tab, selectionStage]);

  useEffect(() => {
    if (tab === "cohort") void fetchCohort();
    else void fetchWeekly();
  }, [tab, fetchWeekly, fetchCohort]);

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

      {/* マトリクス本体 */}
      <div className="px-4 py-3 overflow-x-auto">
        {loading ? (
          <div className="py-8 text-center text-[12px] text-[#9CA3AF]">読み込み中...</div>
        ) : tab === "cohort" ? (
          <CohortTable cohorts={cohorts} />
        ) : (
          <WeekMatrixTable weekly={weekly} rows={ROWS[tab]} />
        )}
      </div>

      {/* 明細を見るボタン（マトリクスタブ連動。cohort は対象外）→ ポップアップ */}
      {tab !== "cohort" && (
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
      {showDetail && tab !== "cohort" && (
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
          const rowBg = r.band ? "bg-[#EFF6FF]" : "bg-white";
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
type CohortRow = {
  label: string;
  num: (c: Cohort) => number | null;
  pct: (c: Cohort) => number | null;
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

function CohortTable({ cohorts }: { cohorts: Cohort[] | null }) {
  if (!cohorts || cohorts.length === 0) return <div className="py-8 text-center text-[12px] text-[#9CA3AF]">データなし</div>;
  return (
    // 段階列＝最長項目名が収まる固定幅（折り返さない）、月12列＝残り幅を均等配分、全幅。
    <table className="w-full text-[12px] border-collapse" style={{ tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: "190px" }} />
        {cohorts.map((c) => (
          <Fragment key={c.yearMonth}>
            <col />
            <col />
          </Fragment>
        ))}
      </colgroup>
      <thead>
        {/* 1段目：段階列＋各月（colSpan=2） */}
        <tr>
          <th rowSpan={2} className={`sticky left-0 ${HEAD_CLS} px-2 py-1.5 text-left font-medium whitespace-nowrap`}>段階</th>
          {cohorts.map((c) => (
            <th key={c.yearMonth} colSpan={2} className={`${HEAD_CLS} px-2 py-1.5 text-center font-medium whitespace-nowrap border-l border-[#5A5A5A]`}>{c.yearMonth}</th>
          ))}
        </tr>
        {/* 2段目：実績｜% */}
        <tr>
          {cohorts.map((c) => (
            <Fragment key={c.yearMonth}>
              <th className={`${HEAD_CLS} px-2 py-1 text-right font-normal text-[10px] ${SUBHEAD_CLS} border-l border-[#5A5A5A]`}>実績</th>
              <th className={`${HEAD_CLS} px-2 py-1 text-right font-normal text-[10px] ${SUBHEAD_CLS}`}>%</th>
            </Fragment>
          ))}
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
                    <td className="px-2 py-1 text-right tabular-nums text-[#374151] font-medium border-l border-[#F3F4F6]">{r.fmt ? r.fmt(n) : numFmt(n)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-[11px] text-[#2563EB]">{pv != null ? pctFmt(pv) : ""}</td>
                  </Fragment>
                );
              })}
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
