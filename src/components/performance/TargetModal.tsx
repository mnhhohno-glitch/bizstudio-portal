"use client";

// T-073: 目標設定ポップアップ。実績表（PerformancePanel）の「目標登録」ボタンから開く。
// 1つの横並び統合表：段階 | 参考値[昨年同月｜前月｜3か月｜半年] | 目標 | 週按分[W1..Wn｜月計]。
// 各段階は「実数値の行」と「率の行」の2行で表示し、参考値・目標・週按分すべての列で縦に揃える。
// 逆算はクライアント計算（reverseCalc）。週按分は businessDays（クライアントでも動く純関数）。
// ※ロジック（reverseCalc / API / allocateToWeeks / handleSave）は不変。レイアウトのみ統合表に再構成。

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
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
type RefBucket = { fromMonth: string; toMonth: string; metrics: RangeMetrics };

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

// 段階行の定義（参考値・目標・週按分で共通の並び）。
// rateKey＝目標の率入力欄に対応する rates のキー。interview は逆算の起点（前段なし）のため入力なし。
const STAGE_ROWS: {
  key: string; label: string;
  count: (m: RangeMetrics) => number; rate: (m: RangeMetrics) => number | null;
  rateKey: RateKey | null;
}[] = [
  { key: "interview", label: "初回面談", count: (m) => m.firstInterviewExecuted, rate: (m) => m.firstInterviewRate, rateKey: null },
  { key: "introduction", label: "紹介", count: (m) => m.jobIntroduced, rate: (m) => m.jobIntroductionRate, rateKey: "introductionRate" },
  { key: "entry", label: "エントリー", count: (m) => m.entry.count, rate: (m) => m.entry.rate ?? null, rateKey: "entryRate" },
  { key: "documentPass", label: "書類通過", count: (m) => m.documentPass.count, rate: (m) => m.documentPass.rate ?? null, rateKey: "documentPassRate" },
  { key: "offer", label: "内定", count: (m) => m.offer.count, rate: (m) => m.offer.rate ?? null, rateKey: "offerRate" },
  { key: "acceptance", label: "承諾", count: (m) => m.acceptance.count, rate: (m) => m.acceptance.rate ?? null, rateKey: "acceptanceRate" },
];

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
      if (tgtRes.ok) {
        const t = (await tgtRes.json()).target;
        if (t) {
          setTargetRevenue(String(t.targetRevenue ?? ""));
          setUnitPrice(String(t.unitPrice ?? ""));
          setRates({
            acceptanceRate: t.acceptanceRate != null ? String(t.acceptanceRate * 100) : "",
            offerRate: t.offerRate != null ? String(t.offerRate * 100) : "",
            documentPassRate: t.documentPassRate != null ? String(t.documentPassRate * 100) : "",
            entryRate: t.entryRate != null ? String(t.entryRate * 100) : "",
            introductionRate: t.introductionRate != null ? String(t.introductionRate * 100) : "",
          });
        }
      }
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
  const complete = isComplete(result);

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
          interviewCount: result.interviewCount,
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
        }),
      });
      if (res.ok) { setSavedMsg("保存しました"); setTimeout(() => onClose(), 600); }
      else { const e = await res.json().catch(() => ({})); alert(e.error || "保存に失敗しました"); }
    } catch { alert("保存に失敗しました"); } finally { setSaving(false); }
  };

  if (!isOpen) return null;

  // 目標の各段階数（表示用）
  const targetCounts: Record<string, number | null> = {
    interview: result.interviewCount,
    introduction: result.introductionCount,
    entry: result.entryCount,
    documentPass: result.documentPassCount,
    offer: result.offerCount,
    acceptance: result.acceptanceCount,
  };

  const numNumericCols = REF_COLS.length + 1 + weeks.length + 1; // 参考値4 + 目標1 + 週N + 月計1

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto bg-white rounded-xl shadow-2xl w-full max-w-[1180px] max-h-[90vh] overflow-y-auto">
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
                  {STAGE_ROWS.map((row) => {
                    const monthTarget = targetCounts[row.key];
                    const alloc = weeklyFor(monthTarget ?? null);
                    return (
                      <Fragment key={row.key}>
                        {/* 実数値の行 */}
                        <tr className="border-t border-[#E5E7EB]">
                          <td className="px-2 py-1.5 text-[#374151] font-medium">{row.label}</td>
                          {REF_COLS.map((c, i) => {
                            const m = reference?.[c.key]?.metrics;
                            return (
                              <td key={c.key} className={`px-2 py-1.5 text-right tabular-nums text-[#374151] ${i === 0 ? "border-l border-[#F3F4F6]" : ""}`}>
                                {loadingRef ? "…" : m ? fmtCount(row.count(m)) : "—"}
                              </td>
                            );
                          })}
                          <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-[#2563EB] border-l border-[#F3F4F6]">
                            {fmtCount(monthTarget ?? null)}
                          </td>
                          {weeks.map((w, i) => (
                            <td key={w.weekIndex} className={`px-2 py-1.5 text-right tabular-nums text-[#374151] ${i === 0 ? "border-l border-[#F3F4F6]" : ""}`}>
                              {alloc ? fmtCount(alloc[i]) : "—"}
                            </td>
                          ))}
                          <td className="px-2 py-1.5 text-right tabular-nums font-medium text-[#374151]">
                            {fmtCount(monthTarget ?? null)}
                          </td>
                        </tr>
                        {/* 率の行（段階名の真下・薄字・インデント） */}
                        <tr className="bg-[#FAFAFA]">
                          <td className="pl-5 pr-2 py-1 text-[#9CA3AF] text-[11px]">{row.label}率</td>
                          {REF_COLS.map((c, i) => {
                            const m = reference?.[c.key]?.metrics;
                            return (
                              <td key={c.key} className={`px-2 py-1 text-right tabular-nums text-[#9CA3AF] text-[11px] ${i === 0 ? "border-l border-[#F3F4F6]" : ""}`}>
                                {loadingRef ? "" : m ? pct(row.rate(m)) : "—"}
                              </td>
                            );
                          })}
                          <td className="px-1.5 py-1 text-right border-l border-[#F3F4F6]">
                            {row.rateKey ? (
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
                          {/* 週按分は実数値の行のみ（率は按分対象外） */}
                          {weeks.map((w, i) => (
                            <td key={w.weekIndex} className={`px-2 py-1 ${i === 0 ? "border-l border-[#F3F4F6]" : ""}`} />
                          ))}
                          <td className="px-2 py-1" />
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[10px] text-[#9CA3AF]">
              数値＝人数／率＝前段からの転換率（参考値は実績、目標は%手入力→人数を逆算）。週按分は各週切り上げ・最終週で帳尻（合計＝月計）。
            </p>

            {/* 保存 */}
            <div className="mt-4 flex items-center gap-2">
              <button onClick={handleSave} disabled={saving || !complete}
                className="bg-[#16A34A] text-white rounded-lg px-5 py-2 text-[13px] font-medium hover:bg-[#15803D] disabled:opacity-50">
                {saving ? "保存中..." : "💾 目標を保存"}
              </button>
              <button onClick={onClose} className="border border-gray-300 text-gray-700 rounded-lg px-4 py-2 text-[13px] font-medium hover:bg-gray-50">閉じる</button>
              {savedMsg && <span className="text-[12px] text-green-600">{savedMsg}</span>}
              {!complete && <span className="text-[10px] text-red-500 ml-auto">売上・単価・各率を入力すると人数が確定します。</span>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
