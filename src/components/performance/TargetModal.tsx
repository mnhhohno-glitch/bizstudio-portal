"use client";

// T-073: 目標設定ポップアップ。実績表（PerformancePanel）の「目標登録」ボタンから開く。
// 1つの横並び統合表：段階 | 参考値[昨年同月｜前月｜3か月｜半年] | 目標 | 週按分[W1..Wn｜月計]。
// 各段階は「実数値の行」と「率の行」の2行で表示し、参考値・目標・週按分すべての列で縦に揃える。
// 逆算はクライアント計算（reverseCalc）。週按分は businessDays（クライアントでも動く純関数）。
// ※ロジック（reverseCalc / API / allocateToWeeks / handleSave）は不変。レイアウトのみ統合表に再構成。

import { useState, useEffect, useCallback, useMemo } from "react";
import { reverseCalc, isComplete, type ReverseCalcInput } from "@/lib/performance/reverseCalc";
import { weeklyBusinessDays, monthBusinessDays, allocateToWeeks } from "@/lib/performance/businessDays";

type CountWithRate = { count: number; rate?: number | null };
type RangeMetrics = {
  firstInterviewExecuted: number;
  firstInterviewRate: number | null;
  jobIntroduced: number;
  jobIntroductionRate: number | null;
  entry: CountWithRate;
  documentPass: CountWithRate;
  offer: CountWithRate;
  acceptance: CountWithRate;
};
type RefBucket = { fromMonth: string; toMonth: string; metrics: RangeMetrics; proposalPerPerson: number | null; interviewExisting: number; interviewTotal: number; decidedUnitPrice: number | null };

interface Props {
  isOpen: boolean;
  onClose: () => void;
  employeeId: string;
  employeeName: string;
  yearMonth: string; // 初期対象月（"YYYY-MM"）
}

// カンマ区切り（人数・週按分・月計）。小数は1桁まで。
const fmtCount = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("ja-JP", { maximumFractionDigits: 1 });
const pct = (r: number | null | undefined) =>
  r === null || r === undefined ? "—" : `${(r * 100).toFixed(1)}%`;
const yen = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `¥${Math.round(v).toLocaleString("ja-JP")}`;
// 入力欄のカンマ表示（整数のみ）。保存・逆算は生の数字文字列で保持。
const onlyDigits = (s: string) => s.replace(/[^\d]/g, "");
const commaInt = (s: string) => { const d = onlyDigits(s); return d ? Number(d).toLocaleString("ja-JP") : ""; };

const REF_COLS: { key: string; label: string }[] = [
  { key: "lastYearSameMonth", label: "昨年同月" },
  { key: "prevMonth", label: "前月" },
  { key: "quarter", label: "3か月" },
  { key: "half", label: "半年" },
];

type RateKey = "introductionRate" | "entryRate" | "documentPassRate" | "offerRate" | "acceptanceRate";

const HEAD_CLS = "bg-[#3C3C3C] text-white";

export default function TargetModal({ isOpen, onClose, employeeId, employeeName, yearMonth: initialYm }: Props) {
  const [yearMonth, setYearMonth] = useState(initialYm);
  const [reference, setReference] = useState<Record<string, RefBucket> | null>(null);
  const [loadingRef, setLoadingRef] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  // 逆算の入力（手入力）。率は % で持つ（表示一致）。
  const [targetRevenue, setTargetRevenue] = useState<string>("");
  const [unitPrice, setUnitPrice] = useState<string>("");
  const [proposalPerPerson, setProposalPerPerson] = useState<string>(""); // 紹介の1人あたり件数（手入力）
  const [firstInterviewRatio, setFirstInterviewRatio] = useState<string>(""); // 合計面談に占める初回面談の割合（%手入力）
  // 週按分の手動調整（初回/既存面談のみ。null=未調整＝自動配分）。各週の文字列で持つ。
  const [ovFirst, setOvFirst] = useState<(string | null)[]>([]);
  const [ovExisting, setOvExisting] = useState<(string | null)[]>([]);
  const [rates, setRates] = useState({
    acceptanceRate: "", offerRate: "", documentPassRate: "", entryRate: "", introductionRate: "",
  });

  useEffect(() => {
    if (isOpen) setYearMonth(initialYm);
  }, [isOpen, initialYm]);

  // 参考値 + 既存目標を取得
  const fetchAll = useCallback(async () => {
    if (!employeeId || !yearMonth) return;
    setLoadingRef(true);
    try {
      const [refRes, tgtRes] = await Promise.all([
        fetch(`/api/performance/target/reference?employeeId=${employeeId}&yearMonth=${yearMonth}`),
        fetch(`/api/performance/target?employeeId=${employeeId}&yearMonth=${yearMonth}`),
      ]);
      if (refRes.ok) setReference((await refRes.json()).reference ?? null);
      const wlen = weeklyBusinessDays(yearMonth).length;
      const nulls = (): (string | null)[] => Array.from({ length: wlen }, () => null);
      if (tgtRes.ok) {
        const t = (await tgtRes.json()).target;
        if (t) {
          setTargetRevenue(String(t.targetRevenue ?? ""));
          setUnitPrice(String(t.unitPrice ?? ""));
          setProposalPerPerson(t.proposalPerPerson != null ? String(t.proposalPerPerson) : "");
          setFirstInterviewRatio(t.firstInterviewRatio != null ? String(t.firstInterviewRatio * 100) : "");
          setRates({
            acceptanceRate: t.acceptanceRate != null ? String(t.acceptanceRate * 100) : "",
            offerRate: t.offerRate != null ? String(t.offerRate * 100) : "",
            documentPassRate: t.documentPassRate != null ? String(t.documentPassRate * 100) : "",
            entryRate: t.entryRate != null ? String(t.entryRate * 100) : "",
            introductionRate: t.introductionRate != null ? String(t.introductionRate * 100) : "",
          });
          // 週按分の手動調整を復元（週数が一致するときのみ。違えば自動配分）。
          const wo = t.weeklyOverrides as { firstInterview?: (number | null)[]; existingInterview?: (number | null)[] } | null;
          const toStr = (arr?: (number | null)[]) => (Array.isArray(arr) && arr.length === wlen ? arr.map((v) => (v == null ? null : String(v))) : nulls());
          setOvFirst(toStr(wo?.firstInterview));
          setOvExisting(toStr(wo?.existingInterview));
        } else {
          setOvFirst(nulls()); setOvExisting(nulls());
        }
      } else { setOvFirst(nulls()); setOvExisting(nulls()); }
    } catch { /* noop */ } finally { setLoadingRef(false); }
  }, [employeeId, yearMonth]);

  useEffect(() => {
    if (isOpen) void fetchAll();
  }, [isOpen, fetchAll]);

  // 逆算（クライアント計算）。率は % → 比率に変換。
  const calcInput: ReverseCalcInput = useMemo(() => ({
    targetRevenue: parseFloat(targetRevenue) || 0,
    unitPrice: parseFloat(unitPrice) || 0,
    acceptanceRate: (parseFloat(rates.acceptanceRate) || 0) / 100,
    offerRate: (parseFloat(rates.offerRate) || 0) / 100,
    documentPassRate: (parseFloat(rates.documentPassRate) || 0) / 100,
    entryRate: (parseFloat(rates.entryRate) || 0) / 100,
    introductionRate: (parseFloat(rates.introductionRate) || 0) / 100,
  }), [targetRevenue, unitPrice, rates]);

  const result = useMemo(() => reverseCalc(calcInput), [calcInput]);
  // 合計面談（逆算）→ 初回%手入力で初回/既存に内訳化（逆算には影響しない・表示と保存用）。
  const ratioFrac = (parseFloat(firstInterviewRatio) || 0) / 100;
  const ratioValid = firstInterviewRatio.trim() !== "" && ratioFrac > 0 && ratioFrac <= 1;
  const totalInterview = result.totalInterviewCount;
  const firstInterview = totalInterview != null && Number.isFinite(totalInterview) ? totalInterview * ratioFrac : null;
  const existingInterview = totalInterview != null && Number.isFinite(totalInterview) ? totalInterview * (1 - ratioFrac) : null;
  const complete = isComplete(result) && ratioValid; // 初回%も入れて初めて確定（初回/既存が算出できる）

  // 週按分（面談数で代表表示。各段階も同様に計算可能だが UI は面談で示す）。
  const weeks = useMemo(() => weeklyBusinessDays(yearMonth), [yearMonth]);
  const monthBiz = useMemo(() => monthBusinessDays(yearMonth), [yearMonth]);

  const weeklyFor = useCallback((monthTarget: number | null) => {
    if (monthTarget === null || !Number.isFinite(monthTarget)) return null;
    return allocateToWeeks(monthTarget, weeks);
  }, [weeks]);

  const handleSave = async () => {
    if (!complete) {
      alert("売上・単価・各率をすべて入力してください（人数が確定しません）。");
      return;
    }
    setSaving(true);
    setSavedMsg("");
    try {
      const res = await fetch("/api/performance/target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId, yearMonth,
          targetRevenue: calcInput.targetRevenue,
          unitPrice: calcInput.unitPrice,
          interviewCount: firstInterview,        // 初回面談（達成率は初回実績と比較するため初回を保存）
          existingInterviewCount: existingInterview, // 既存面談（合計面談×(1-初回%)）
          introductionCount: result.introductionCount,
          entryCount: result.entryCount,
          documentPassCount: result.documentPassCount,
          offerCount: result.offerCount,
          acceptanceCount: result.acceptanceCount,
          introductionRate: calcInput.introductionRate,
          entryRate: calcInput.entryRate,
          documentPassRate: calcInput.documentPassRate,
          offerRate: calcInput.offerRate,
          acceptanceRate: calcInput.acceptanceRate,
          proposalPerPerson: parseFloat(proposalPerPerson) || null,
          firstInterviewRatio: ratioFrac,        // 合計面談に占める初回の割合（0〜1）
          // 週按分の手動調整（初回/既存面談）。未調整なら null（＝自動配分）。
          weeklyOverrides: (ovFirst.some((v) => v != null && v !== "") || ovExisting.some((v) => v != null && v !== ""))
            ? {
                firstInterview: ovFirst.map((v) => (v == null || v === "" ? null : (parseFloat(v) || 0))),
                existingInterview: ovExisting.map((v) => (v == null || v === "" ? null : (parseFloat(v) || 0))),
              }
            : null,
        }),
      });
      if (res.ok) { setSavedMsg("保存しました"); setTimeout(() => onClose(), 600); }
      else { const e = await res.json().catch(() => ({})); alert(e.error || "保存に失敗しました"); }
    } catch { alert("保存に失敗しました"); } finally { setSaving(false); }
  };

  if (!isOpen) return null;

  // 目標の各段階数（表示用）。面談は 合計面談（逆算）＋初回/既存（内訳）。
  const targetCounts: Record<string, number | null> = {
    interviewTotal: totalInterview,
    interviewFirst: firstInterview,
    interviewExisting: existingInterview,
    introduction: result.introductionCount,
    entry: result.entryCount,
    documentPass: result.documentPassCount,
    offer: result.offerCount,
    acceptance: result.acceptanceCount,
  };

  // 紹介（件数）＝紹介人数 × 1人あたり件数（手入力）。未入力なら null。
  const ppNum = parseFloat(proposalPerPerson);
  const introducedRecs = result.introductionCount != null && Number.isFinite(result.introductionCount) && ppNum > 0
    ? result.introductionCount * ppNum : null;
  // 合計面談の週按分（初回/既存の各週内訳の母数＝自動配分）。
  const allocTotalIv = weeklyFor(targetCounts.interviewTotal ?? null);
  // 各週の率/係数は月固定（週で変えない）→ 各週同じ値を表示。
  const introRatePct = pct(calcInput.introductionRate);

  // 週按分の手動調整：各週の実効値＝手動値があればそれ、無ければ自動配分。
  const autoFirst = (i: number) => (allocTotalIv ? allocTotalIv[i] * ratioFrac : null);
  const autoExisting = (i: number) => (allocTotalIv ? allocTotalIv[i] * (1 - ratioFrac) : null);
  const effFirst = (i: number): number | null => { const o = ovFirst[i]; return o != null && o !== "" ? (parseFloat(o) || 0) : autoFirst(i); };
  const effExisting = (i: number): number | null => { const o = ovExisting[i]; return o != null && o !== "" ? (parseFloat(o) || 0) : autoExisting(i); };
  const effTotal = (i: number): number | null => { const f = effFirst(i), e = effExisting(i); return f == null || e == null ? null : f + e; };
  const sumFirst = weeks.reduce((s, _w, i) => s + (effFirst(i) ?? 0), 0);
  const sumExisting = weeks.reduce((s, _w, i) => s + (effExisting(i) ?? 0), 0);
  const sumTotalIv = sumFirst + sumExisting;
  const hasOverride = ovFirst.some((v) => v != null && v !== "") || ovExisting.some((v) => v != null && v !== "");
  // 超過：手動調整時のみ判定。初回+既存の週合計が月の合計面談目標を超えたらエラー（保存ブロック）。
  const monthIvTarget = targetCounts.interviewTotal;
  const ivOver = hasOverride && monthIvTarget != null && Number.isFinite(monthIvTarget) && sumTotalIv > monthIvTarget + 0.5;
  const resetWeekly = () => { setOvFirst(weeks.map(() => null)); setOvExisting(weeks.map(() => null)); };

  // 統合表の行モデル。
  //   kind: count=逆算自動(青字) / rate=率%手入力 / pp=1人あたり件数手入力 / recs=件数自動(青字) / fipct=初回%手入力。
  //   week: alloc=週按分する(合計面談・紹介人数・紹介件数・エントリー) / dash=週按分しない「—」(書類通過以降) / empty=空。
  //   weekText/monthText：empty 行でも各週/月計に表示する値（初回/既存の内訳・率の月固定値）。targetText：目標セルの表示上書き（¥など）。
  type Wmode = "alloc" | "dash" | "empty";
  const funnelRows: {
    key: string; label: string; indent?: boolean;
    kind: "count" | "rate" | "pp" | "recs" | "fipct";
    ref: (b: RefBucket | undefined) => string;
    targetValue?: number | null; rateKey?: RateKey | null; targetText?: string;
    week: Wmode; weekTarget?: number | null;
    weekText?: (i: number) => string; monthText?: string;
    weekInput?: { value: (i: number) => string; onChange: (i: number, v: string) => void }; // 週セルを手入力可に（初回/既存面談）
    monthOver?: boolean; // 月計が月目標超過（赤表示）
  }[] = [
    // 面談：合計面談（＝初回+既存の週合計・直接編集不可）→ 初回%（内訳率）→ 初回面談（手入力可）→ 既存面談（手入力可）。
    // 初回/既存は手入力で週調整可。未調整の週は自動配分（合計面談按分×初回%／×(1-初回%)）。合計面談（各週）＝初回+既存。
    { key: "interviewTotal", label: "合計面談", kind: "count",
      ref: (b) => (b ? `${fmtCount(b.interviewTotal)}（${pct(b.interviewTotal > 0 ? 1 : null)}）` : "—"),
      targetValue: targetCounts.interviewTotal, week: "empty",
      weekText: (i) => fmtCount(effTotal(i)), monthText: fmtCount(sumTotalIv), monthOver: ivOver },
    { key: "firstRatio", label: "初回面談率（内訳）", indent: true, kind: "fipct",
      ref: (b) => (b ? pct(b.interviewTotal > 0 ? b.metrics.firstInterviewExecuted / b.interviewTotal : null) : "—"), week: "empty" },
    { key: "interviewFirst", label: "初回面談", indent: true, kind: "count",
      ref: (b) => (b ? `${fmtCount(b.metrics.firstInterviewExecuted)}（${pct(b.interviewTotal > 0 ? b.metrics.firstInterviewExecuted / b.interviewTotal : null)}）` : "—"),
      targetValue: targetCounts.interviewFirst, week: "empty",
      weekInput: { value: (i) => { const o = ovFirst[i]; const v = o != null && o !== "" ? o : (autoFirst(i) != null ? String(Math.round((autoFirst(i) as number) * 10) / 10) : ""); return v; }, onChange: (i, v) => setOvFirst((s) => { const n = [...s]; n[i] = v === "" ? null : v; return n; }) },
      monthText: fmtCount(sumFirst) },
    { key: "interviewExisting", label: "既存面談", indent: true, kind: "count",
      ref: (b) => (b ? `${fmtCount(b.interviewExisting)}（${pct(b.interviewTotal > 0 ? b.interviewExisting / b.interviewTotal : null)}）` : "—"),
      targetValue: targetCounts.interviewExisting, week: "empty",
      weekInput: { value: (i) => { const o = ovExisting[i]; const v = o != null && o !== "" ? o : (autoExisting(i) != null ? String(Math.round((autoExisting(i) as number) * 10) / 10) : ""); return v; }, onChange: (i, v) => setOvExisting((s) => { const n = [...s]; n[i] = v === "" ? null : v; return n; }) },
      monthText: fmtCount(sumExisting) },
    { key: "introduction", label: "紹介（人数）", kind: "count", ref: (b) => (b ? fmtCount(b.metrics.jobIntroduced) : "—"), targetValue: targetCounts.introduction, week: "alloc", weekTarget: targetCounts.introduction },
    { key: "introductionRate", label: "紹介率", indent: true, kind: "rate", rateKey: "introductionRate", ref: (b) => (b ? pct(b.metrics.jobIntroductionRate) : "—"), week: "empty",
      weekText: () => (calcInput.introductionRate > 0 ? introRatePct : "—"), monthText: calcInput.introductionRate > 0 ? introRatePct : "—" },
    { key: "perPerson", label: "1人あたり件数", indent: true, kind: "pp", ref: (b) => (b ? fmtCount(b.proposalPerPerson) : "—"), week: "empty",
      weekText: () => (ppNum > 0 ? fmtCount(ppNum) : "—"), monthText: ppNum > 0 ? fmtCount(ppNum) : "—" },
    { key: "introductionRecs", label: "紹介（件数）", indent: true, kind: "recs", ref: (b) => (b && b.proposalPerPerson != null ? fmtCount(b.metrics.jobIntroduced * b.proposalPerPerson) : "—"), targetValue: introducedRecs, week: "alloc", weekTarget: introducedRecs },
    { key: "entry", label: "エントリー", kind: "count", ref: (b) => (b ? fmtCount(b.metrics.entry.count) : "—"), targetValue: targetCounts.entry, week: "alloc", weekTarget: targetCounts.entry },
    { key: "entryRate", label: "エントリー率", indent: true, kind: "rate", rateKey: "entryRate", ref: (b) => (b ? pct(b.metrics.entry.rate) : "—"), week: "empty" },
    { key: "documentPass", label: "書類通過", kind: "count", ref: (b) => (b ? fmtCount(b.metrics.documentPass.count) : "—"), targetValue: targetCounts.documentPass, week: "dash" },
    { key: "documentPassRate", label: "書類通過率", indent: true, kind: "rate", rateKey: "documentPassRate", ref: (b) => (b ? pct(b.metrics.documentPass.rate) : "—"), week: "empty" },
    { key: "offer", label: "内定", kind: "count", ref: (b) => (b ? fmtCount(b.metrics.offer.count) : "—"), targetValue: targetCounts.offer, week: "dash" },
    { key: "offerRate", label: "内定率", indent: true, kind: "rate", rateKey: "offerRate", ref: (b) => (b ? pct(b.metrics.offer.rate) : "—"), week: "empty" },
    { key: "acceptance", label: "承諾", kind: "count", ref: (b) => (b ? fmtCount(b.metrics.acceptance.count) : "—"), targetValue: targetCounts.acceptance, week: "dash" },
    { key: "acceptanceRate", label: "承諾率", indent: true, kind: "rate", rateKey: "acceptanceRate", ref: (b) => (b ? pct(b.metrics.acceptance.rate) : "—"), week: "empty" },
    // T-099: 粗利単価（決定粗利単価）：参考値＝実績の決定粗利÷決定数（matrix.selection.decidedUnitPrice、cost控除後）。目標＝上部で手入力した単価。
    { key: "unitPrice", label: "粗利単価（決定粗利単価）", kind: "count", ref: (b) => (b ? yen(b.decidedUnitPrice) : "—"),
      targetText: yen(parseFloat(unitPrice) || null), week: "empty" },
  ];

  const numNumericCols = REF_COLS.length + 1 + weeks.length + 1; // 参考値4 + 目標1 + 週N + 月計1

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto bg-white rounded-xl shadow-2xl w-full max-w-[1320px] max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 sticky top-0 bg-white z-10">
            <h2 className="text-[15px] font-semibold text-[#374151]">🎯 目標登録 — {employeeName}</h2>
            <div className="flex items-center gap-2">
              <input type="month" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)}
                className="text-[12px] border border-gray-200 rounded px-2 py-1" />
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg px-1">✕</button>
            </div>
          </div>

          <div className="p-5">
            {/* 売上・単価（逆算の起点） */}
            <div className="flex flex-wrap items-center gap-4 mb-4">
              <div className="flex items-center gap-2">
                <label className="text-[12px] text-[#6B7280] w-16">目標売上</label>
                <input type="text" inputMode="numeric" value={commaInt(targetRevenue)}
                  onChange={(e) => setTargetRevenue(onlyDigits(e.target.value))}
                  className="w-40 border border-gray-300 rounded px-2 py-1.5 text-[13px] text-right tabular-nums" placeholder="例: 3,000,000" />
                <span className="text-[11px] text-[#9CA3AF]">円</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[12px] text-[#6B7280] w-16">売上単価</label>
                <input type="text" inputMode="numeric" value={commaInt(unitPrice)}
                  onChange={(e) => setUnitPrice(onlyDigits(e.target.value))}
                  className="w-40 border border-gray-300 rounded px-2 py-1.5 text-[13px] text-right tabular-nums" placeholder="例: 600,000" />
                <span className="text-[11px] text-[#9CA3AF]">円/承諾</span>
              </div>
              <span className="text-[11px] text-[#9CA3AF] ml-auto">営業日 {monthBiz} 日</span>
            </div>

            {/* 横並び統合表 */}
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-[12px]" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "132px" }} />
                  {Array.from({ length: numNumericCols }).map((_, i) => <col key={i} />)}
                </colgroup>
                <thead>
                  <tr>
                    <th rowSpan={2} className={`${HEAD_CLS} px-2 py-2 text-left font-medium align-bottom`}>段階</th>
                    <th colSpan={REF_COLS.length} className={`${HEAD_CLS} px-2 py-1.5 text-center font-medium border-l border-[#555]`}>参考値（実績）</th>
                    <th rowSpan={2} className={`${HEAD_CLS} px-2 py-2 text-center font-medium align-bottom border-l border-[#555]`}>目標</th>
                    <th colSpan={weeks.length + 1} className={`${HEAD_CLS} px-2 py-1.5 text-center font-medium border-l border-[#555]`}>週按分</th>
                  </tr>
                  <tr>
                    {REF_COLS.map((c, i) => (
                      <th key={c.key} className={`${HEAD_CLS} px-2 py-1.5 text-right font-normal text-[11px] ${i === 0 ? "border-l border-[#555]" : ""}`}>{c.label}</th>
                    ))}
                    {weeks.map((w, i) => (
                      <th key={w.weekIndex} className={`${HEAD_CLS} px-2 py-1.5 text-right font-normal text-[11px] ${i === 0 ? "border-l border-[#555]" : ""}`}>
                        W{w.weekIndex + 1}<span className="text-[9px] text-[#D1D5DB] ml-0.5">({w.businessDays})</span>
                      </th>
                    ))}
                    <th className={`${HEAD_CLS} px-2 py-1.5 text-right font-medium text-[11px]`}>月計</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {funnelRows.map((row) => {
                    const isSub = row.kind === "rate" || row.kind === "pp" || row.kind === "fipct"; // 薄字・按分なしの行
                    const alloc = row.week === "alloc" ? weeklyFor(row.weekTarget ?? null) : null;
                    const padY = isSub ? "py-1" : "py-1.5";
                    const weekCell = (i: number) =>
                      row.weekText ? row.weekText(i) // 内訳・率の各週表示（empty 行でも表示）
                        : row.week === "alloc" ? (alloc ? fmtCount(alloc[i]) : "—") : row.week === "dash" ? "—" : "";
                    return (
                      <tr key={row.key} className={`${isSub ? "bg-[#FAFAFA]" : ""} ${!row.indent ? "border-t border-[#E5E7EB]" : ""}`}>
                        <td className={row.indent ? `pl-5 pr-2 ${padY} text-[#9CA3AF] text-[11px]` : `px-2 ${padY} text-[#374151] font-medium`}>{row.label}</td>
                        {/* 参考値 */}
                        {REF_COLS.map((c, i) => (
                          <td key={c.key} className={`px-2 ${padY} text-right tabular-nums ${isSub ? "text-[#9CA3AF] text-[11px]" : "text-[#374151]"} ${i === 0 ? "border-l border-[#F3F4F6]" : ""}`}>
                            {loadingRef ? (isSub ? "" : "…") : row.ref(reference?.[c.key])}
                          </td>
                        ))}
                        {/* 目標 */}
                        <td className={`px-1.5 ${padY} text-right border-l border-[#F3F4F6]`}>
                          {row.kind === "count" || row.kind === "recs" ? (
                            <span className="tabular-nums font-semibold text-[#2563EB]">{row.targetText ?? fmtCount(row.targetValue ?? null)}</span>
                          ) : row.kind === "pp" ? (
                            <span className="inline-flex items-center gap-0.5 justify-end">
                              <input type="number" value={proposalPerPerson} onChange={(e) => setProposalPerPerson(e.target.value)}
                                className="w-12 border border-gray-300 rounded px-1 py-0.5 text-[11px] text-right" placeholder="件" />
                              <span className="text-[10px] text-[#9CA3AF]">件</span>
                            </span>
                          ) : row.kind === "fipct" ? (
                            <span className="inline-flex items-center gap-0.5 justify-end">
                              <input type="number" value={firstInterviewRatio} onChange={(e) => setFirstInterviewRatio(e.target.value)}
                                className="w-12 border border-gray-300 rounded px-1 py-0.5 text-[11px] text-right" placeholder="%" />
                              <span className="text-[10px] text-[#9CA3AF]">%</span>
                            </span>
                          ) : row.rateKey ? (
                            <span className="inline-flex items-center gap-0.5 justify-end">
                              <input type="number" value={rates[row.rateKey]}
                                onChange={(e) => setRates((s) => ({ ...s, [row.rateKey as RateKey]: e.target.value }))}
                                className="w-12 border border-gray-300 rounded px-1 py-0.5 text-[11px] text-right" placeholder="%" />
                              <span className="text-[10px] text-[#9CA3AF]">%</span>
                            </span>
                          ) : (
                            <span className="text-[11px] text-[#C0C4CC]">—</span>
                          )}
                        </td>
                        {/* 週按分（初回/既存面談は手入力可） */}
                        {weeks.map((w, i) => (
                          <td key={w.weekIndex} className={`px-1 ${padY} text-right tabular-nums text-[#374151] ${i === 0 ? "border-l border-[#F3F4F6]" : ""}`}>
                            {row.weekInput ? (
                              <input type="number" value={row.weekInput.value(i)} onChange={(e) => row.weekInput!.onChange(i, e.target.value)}
                                className={`w-full max-w-[44px] border rounded px-0.5 py-0.5 text-[11px] text-right ${ivOver ? "border-red-400 bg-red-50" : "border-gray-200"}`} />
                            ) : weekCell(i)}
                          </td>
                        ))}
                        <td className={`px-2 ${padY} text-right tabular-nums font-medium ${row.monthOver ? "text-red-600" : "text-[#374151]"}`}>
                          {row.monthText ?? (row.week === "alloc" ? fmtCount(row.weekTarget ?? null) : row.week === "dash" ? "—" : "")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[10px] text-[#9CA3AF]">
              数値＝人数／率＝前段からの転換率（参考値は実績、目標は%手入力→人数を逆算）。**面談は紹介÷紹介率＝合計面談が逆算の母数**。初回面談＝合計面談×初回%（手入力）、既存面談＝残り（内訳・逆算非影響）。紹介件数＝紹介人数×1人あたり件数（手入力）。
              週按分は合計面談・紹介（人数・件数）・エントリー（各週切り上げ・最終週で帳尻、合計＝月計）。**初回面談・既存面談は各週セルを手入力で調整可**（合計面談＝初回+既存で自動更新）。未調整の週は自動配分（合計面談の週按分×初回%）。1人あたり件数・紹介率は月固定値を各週表示。書類通過・内定・承諾は週按分しない（「—」）。売上単価（決定単価）は参考値＝実績の決定売上÷決定数（売上未記録期間は「—」）。
            </p>

            {/* 週按分の手動調整：超過エラー＋自動配分に戻す */}
            <div className="mt-1.5 flex items-center gap-3">
              {ivOver && <span className="text-[11px] text-red-600 font-medium">⚠️ 面談のW合計（{fmtCount(sumTotalIv)}）が月目標（{fmtCount(monthIvTarget ?? null)}）を超えています。調整してください（保存不可）。</span>}
              {hasOverride && <button onClick={resetWeekly} className="text-[11px] text-[#2563EB] border border-[#2563EB] rounded px-2 py-0.5 hover:bg-blue-50">面談の週按分を自動配分に戻す</button>}
            </div>

            {/* 保存 */}
            <div className="mt-4 flex items-center gap-2">
              <button onClick={handleSave} disabled={saving || !complete || ivOver}
                className="bg-[#16A34A] text-white rounded-lg px-5 py-2 text-[13px] font-medium hover:bg-[#15803D] disabled:opacity-50">
                {saving ? "保存中..." : "💾 目標を保存"}
              </button>
              <button onClick={onClose} className="border border-gray-300 text-gray-700 rounded-lg px-4 py-2 text-[13px] font-medium hover:bg-gray-50">閉じる</button>
              {savedMsg && <span className="text-[12px] text-green-600">{savedMsg}</span>}
              {!complete && !ivOver && <span className="text-[10px] text-red-500 ml-auto">売上・単価・各率を入力すると人数が確定します。</span>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
