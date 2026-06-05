"use client";

// T-073: 目標設定ポップアップ。実績表（PerformancePanel）の「目標登録」ボタンから開く。
// 左：参考値（昨年同月/前月/3か月/半年 × 各段階の数・率）。
// 右：逆算入力（売上・単価・各率を手入力 → 人数を自動計算）＋週按分プレビュー。
// 逆算はクライアント計算（reverseCalc）。週按分は businessDays（クライアントでも動く純関数）。

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
type RefBucket = { fromMonth: string; toMonth: string; metrics: RangeMetrics };

interface Props {
  isOpen: boolean;
  onClose: () => void;
  employeeId: string;
  employeeName: string;
  yearMonth: string; // 初期対象月（"YYYY-MM"）
}

const num = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits);
const pct = (r: number | null | undefined) =>
  r === null || r === undefined ? "—" : `${(r * 100).toFixed(1)}%`;

const REF_COLS: { key: string; label: string }[] = [
  { key: "lastYearSameMonth", label: "昨年同月" },
  { key: "prevMonth", label: "前月" },
  { key: "quarter", label: "3か月" },
  { key: "half", label: "半年" },
];

// 段階行の定義（参考値テーブル・目標で共通の並び）。
const STAGE_ROWS: { key: string; label: string; count: (m: RangeMetrics) => number; rate: (m: RangeMetrics) => number | null }[] = [
  { key: "interview", label: "初回面談", count: (m) => m.firstInterviewExecuted, rate: (m) => m.firstInterviewRate },
  { key: "introduction", label: "紹介", count: (m) => m.jobIntroduced, rate: (m) => m.jobIntroductionRate },
  { key: "entry", label: "エントリー", count: (m) => m.entry.count, rate: (m) => m.entry.rate ?? null },
  { key: "documentPass", label: "書類通過", count: (m) => m.documentPass.count, rate: (m) => m.documentPass.rate ?? null },
  { key: "offer", label: "内定", count: (m) => m.offer.count, rate: (m) => m.offer.rate ?? null },
  { key: "acceptance", label: "承諾", count: (m) => m.acceptance.count, rate: (m) => m.acceptance.rate ?? null },
];

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

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto bg-white rounded-xl shadow-2xl w-full max-w-[1100px] max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 sticky top-0 bg-white z-10">
            <h2 className="text-[15px] font-semibold text-[#374151]">
              🎯 目標登録 — {employeeName}
            </h2>
            <div className="flex items-center gap-2">
              <input
                type="month"
                value={yearMonth}
                onChange={(e) => setYearMonth(e.target.value)}
                className="text-[12px] border border-gray-200 rounded px-2 py-1"
              />
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg px-1">✕</button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-5">
            {/* === 左：参考値 === */}
            <div>
              <h3 className="text-[13px] font-medium text-[#374151] mb-2">参考値（実績）</h3>
              {loadingRef ? (
                <div className="py-8 text-center text-[12px] text-[#9CA3AF]">読み込み中...</div>
              ) : !reference ? (
                <div className="py-8 text-center text-[12px] text-[#9CA3AF]">データなし</div>
              ) : (
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-[#F9FAFB] text-[#6B7280]">
                        <th className="px-2 py-1.5 text-left font-medium">段階</th>
                        {REF_COLS.map((c) => (
                          <th key={c.key} className="px-2 py-1.5 text-right font-medium whitespace-nowrap">{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {STAGE_ROWS.map((row) => (
                        <tr key={row.key}>
                          <td className="px-2 py-1.5 text-[#374151]">{row.label}</td>
                          {REF_COLS.map((c) => {
                            const m = reference[c.key]?.metrics;
                            return (
                              <td key={c.key} className="px-2 py-1.5 text-right tabular-nums">
                                {m ? (
                                  <span>
                                    <span className="text-[#374151] font-medium">{row.count(m)}</span>
                                    <span className="text-[#9CA3AF] ml-1">{pct(row.rate(m))}</span>
                                  </span>
                                ) : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-1 text-[10px] text-[#9CA3AF]">数値＝実績数 / 率＝前段からの転換率。上司と見ながら目標％を決める。</p>
            </div>

            {/* === 右：逆算入力 + 週按分 === */}
            <div>
              <h3 className="text-[13px] font-medium text-[#374151] mb-2">目標（逆算）</h3>
              <div className="space-y-2 border border-gray-200 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-[#6B7280] w-20">目標売上</label>
                  <input type="number" value={targetRevenue} onChange={(e) => setTargetRevenue(e.target.value)}
                    className="flex-1 border border-gray-300 rounded px-2 py-1 text-[12px] text-right" placeholder="例: 3000000" />
                  <span className="text-[10px] text-[#9CA3AF]">円</span>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-[#6B7280] w-20">売上単価</label>
                  <input type="number" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)}
                    className="flex-1 border border-gray-300 rounded px-2 py-1 text-[12px] text-right" placeholder="例: 600000" />
                  <span className="text-[10px] text-[#9CA3AF]">円/承諾</span>
                </div>

                {/* 逆算チェーン（下から上） */}
                <div className="mt-2 border-t border-[#F3F4F6] pt-2 space-y-1">
                  <StageLine label="承諾" count={targetCounts.acceptance} />
                  <RateLine label="承諾率" value={rates.acceptanceRate} onChange={(v) => setRates((s) => ({ ...s, acceptanceRate: v }))} />
                  <StageLine label="内定" count={targetCounts.offer} />
                  <RateLine label="内定率" value={rates.offerRate} onChange={(v) => setRates((s) => ({ ...s, offerRate: v }))} />
                  <StageLine label="書類通過" count={targetCounts.documentPass} />
                  <RateLine label="書類通過率" value={rates.documentPassRate} onChange={(v) => setRates((s) => ({ ...s, documentPassRate: v }))} />
                  <StageLine label="エントリー" count={targetCounts.entry} />
                  <RateLine label="エントリー率" value={rates.entryRate} onChange={(v) => setRates((s) => ({ ...s, entryRate: v }))} />
                  <StageLine label="紹介" count={targetCounts.introduction} />
                  <RateLine label="紹介率" value={rates.introductionRate} onChange={(v) => setRates((s) => ({ ...s, introductionRate: v }))} />
                  <StageLine label="面談" count={targetCounts.interview} emphasize />
                </div>
              </div>

              {/* 週按分 */}
              <div className="mt-3">
                <h3 className="text-[13px] font-medium text-[#374151] mb-1">週按分（営業日 {monthBiz} 日）</h3>
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-[#F9FAFB] text-[#6B7280]">
                        <th className="px-2 py-1.5 text-left font-medium">段階</th>
                        {weeks.map((w) => (
                          <th key={w.weekIndex} className="px-2 py-1.5 text-right font-medium whitespace-nowrap">
                            W{w.weekIndex + 1}<span className="text-[9px] text-[#9CA3AF] ml-0.5">({w.businessDays}日)</span>
                          </th>
                        ))}
                        <th className="px-2 py-1.5 text-right font-medium">月計</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {STAGE_ROWS.map((row) => {
                        const monthTarget = targetCounts[row.key];
                        const alloc = weeklyFor(monthTarget ?? null);
                        return (
                          <tr key={row.key}>
                            <td className="px-2 py-1.5 text-[#374151]">{row.label}</td>
                            {weeks.map((w, i) => (
                              <td key={w.weekIndex} className="px-2 py-1.5 text-right tabular-nums text-[#374151]">
                                {alloc ? num(alloc[i]) : "—"}
                              </td>
                            ))}
                            <td className="px-2 py-1.5 text-right tabular-nums font-medium text-[#374151]">
                              {num(monthTarget ?? null)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-[10px] text-[#9CA3AF]">各週は切り上げ、最終週で帳尻（合計＝月計）。</p>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button onClick={handleSave} disabled={saving || !complete}
                  className="flex-1 bg-[#16A34A] text-white rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[#15803D] disabled:opacity-50">
                  {saving ? "保存中..." : "💾 目標を保存"}
                </button>
                <button onClick={onClose} className="border border-gray-300 text-gray-700 rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-gray-50">
                  閉じる
                </button>
                {savedMsg && <span className="text-[12px] text-green-600">{savedMsg}</span>}
              </div>
              {!complete && <p className="mt-1 text-[10px] text-red-500">売上・単価・各率を入力すると人数が確定します。</p>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function StageLine({ label, count, emphasize }: { label: string; count: number | null | undefined; emphasize?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-2 py-1 rounded ${emphasize ? "bg-[#EFF6FF]" : ""}`}>
      <span className="text-[11px] text-[#6B7280]">{label}</span>
      <span className={`text-[12px] tabular-nums ${emphasize ? "font-semibold text-[#2563EB]" : "font-medium text-[#374151]"}`}>
        {num(count)}
      </span>
    </div>
  );
}

function RateLine({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between px-2 py-0.5">
      <span className="text-[10px] text-[#9CA3AF]">{label}</span>
      <span className="flex items-center gap-1">
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)}
          className="w-16 border border-gray-300 rounded px-1.5 py-0.5 text-[11px] text-right" placeholder="%" />
        <span className="text-[10px] text-[#9CA3AF]">%</span>
      </span>
    </div>
  );
}
