"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { MonthlyRecord, MonthlySummary } from "@/lib/attendance/records";

type Employee = { id: string; employeeNumber: string; name: string };

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  FINISHED: { label: "出勤", cls: "bg-green-100 text-green-800" },
  NOT_STARTED: { label: "公休", cls: "bg-gray-100 text-gray-500" },
  PAID_LEAVE: { label: "有給", cls: "bg-purple-100 text-purple-800" },
  CORRECTED: { label: "修正済", cls: "bg-amber-100 text-amber-800" },
  WORKING: { label: "勤務中", cls: "bg-blue-100 text-blue-800" },
};

function fmtTotal(sec: number): string {
  if (sec === 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

export default function RecordsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [months, setMonths] = useState<{ year: number; month: number }[]>([]);
  const [records, setRecords] = useState<MonthlyRecord[]>([]);
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [selectedYear, setSelectedYear] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState(0);
  const [loading, setLoading] = useState(true);

  // Load employees
  useEffect(() => {
    fetch("/api/attendance/records")
      .then((r) => r.json())
      .then((d) => {
        setEmployees(d.employees ?? []);
        if (d.employees?.length > 0) setSelectedEmpId(d.employees[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Load months when employee changes
  useEffect(() => {
    if (!selectedEmpId) return;
    fetch(`/api/attendance/records?employeeId=${selectedEmpId}`)
      .then((r) => r.json())
      .then((d) => {
        const ms = d.months ?? [];
        setMonths(ms);
        if (ms.length > 0) { setSelectedYear(ms[0].year); setSelectedMonth(ms[0].month); }
        else { setSelectedYear(0); setSelectedMonth(0); setRecords([]); setSummary(null); }
      })
      .catch(() => {});
  }, [selectedEmpId]);

  // Load records when year/month changes
  const fetchRecords = useCallback(() => {
    if (!selectedEmpId || !selectedYear || !selectedMonth) return;
    setLoading(true);
    fetch(`/api/attendance/records?employeeId=${selectedEmpId}&year=${selectedYear}&month=${selectedMonth}`)
      .then((r) => r.json())
      .then((d) => { setRecords(d.records ?? []); setSummary(d.summary ?? null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedEmpId, selectedYear, selectedMonth]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const selectedEmp = employees.find((e) => e.id === selectedEmpId);

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <Link href="/attendance/admin" className="text-[14px] text-[#6B7280] hover:text-[#374151]">&larr; 管理者メニュー</Link>
        <h1 className="text-[18px] font-bold text-[#1E3A8A]">勤怠一覧</h1>
      </div>

      {/* Filter Bar */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">社員</label>
          <select value={selectedEmpId} onChange={(e) => setSelectedEmpId(e.target.value)}
            className="rounded-[6px] border border-[#D1D5DB] px-2 py-1.5 text-[13px]">
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}（{e.employeeNumber}）</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">年月</label>
          <select
            value={`${selectedYear}-${selectedMonth}`}
            onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); setSelectedYear(y); setSelectedMonth(m); }}
            className="rounded-[6px] border border-[#D1D5DB] px-2 py-1.5 text-[13px]"
          >
            {months.map((m) => (
              <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>{m.year}年{m.month}月</option>
            ))}
          </select>
        </div>
        <a
          href={`/api/attendance/export?year=${selectedYear}&month=${selectedMonth}`}
          className="rounded-[6px] bg-[#2563EB] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8]"
        >
          Excel出力
        </a>
      </div>

      {/* Monthly Summary Card */}
      {summary && !loading && (
        <div className="mb-4 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
          <div className="grid grid-cols-5 gap-3 mb-3">
            {[
              { label: "休憩", value: fmtTotal(summary.totalBreak) },
              { label: "中断", value: fmtTotal(summary.totalInterrupt) },
              { label: "残業", value: fmtTotal(summary.totalOvertime) },
              { label: "実働", value: fmtTotal(summary.totalWork) },
              { label: "深夜", value: fmtTotal(summary.totalNightTime) },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-[11px] text-[#9CA3AF]">{item.label}</p>
                <p className="text-[15px] font-medium tabular-nums text-[#374151]">{item.value}</p>
              </div>
            ))}
          </div>
          <p className="text-[13px] text-[#6B7280]">
            出勤: <span className="font-medium text-[#374151]">{summary.workDays}日</span>
            <span className="mx-2">／</span>
            有給: <span className="font-medium text-purple-700">{summary.paidLeaveDays}日</span>
            <span className="mx-2">／</span>
            公休: <span className="font-medium text-[#374151]">{summary.offDays}日</span>
          </p>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] overflow-x-auto">
        <table className="w-full text-[13px]" style={{ minWidth: 800 }}>
          <thead>
            <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-left text-[11px] font-medium text-[#6B7280] sticky top-0 z-10">
              <th className="px-2 py-2 w-[50px]">日付</th>
              <th className="px-2 py-2 w-[30px]">曜</th>
              <th className="px-2 py-2 w-[56px]">状況</th>
              <th className="px-2 py-2 w-[50px]">出勤</th>
              <th className="px-2 py-2 w-[50px]">退勤</th>
              <th className="px-2 py-2 w-[56px]">休憩開始</th>
              <th className="px-2 py-2 w-[56px]">休憩終了</th>
              <th className="px-2 py-2 w-[50px]">休憩</th>
              <th className="px-2 py-2 w-[50px]">中断</th>
              <th className="px-2 py-2 w-[50px]">残業</th>
              <th className="px-2 py-2 w-[50px]">実働</th>
              <th className="px-2 py-2 w-[50px]">深夜</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} className="py-12 text-center text-[#6B7280]">読み込み中...</td></tr>
            ) : records.length === 0 ? (
              <tr><td colSpan={12} className="py-12 text-center text-[#6B7280]">データがありません</td></tr>
            ) : (
              <>
                {records.map((r) => {
                  const isOff = r.status === "NOT_STARTED";
                  const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.NOT_STARTED;
                  const dowCls = r.dayOfWeekNum === 0 ? "text-red-500" : r.dayOfWeekNum === 6 ? "text-blue-500" : "";
                  const rowCls = isOff ? "text-gray-400" : "";

                  return (
                    <tr key={r.date} className={`border-b border-[#F3F4F6] hover:bg-gray-50 ${rowCls}`}>
                      <td className="px-2 py-1.5 tabular-nums">{r.day}</td>
                      <td className={`px-2 py-1.5 ${dowCls}`}>{r.dayOfWeek}</td>
                      <td className="px-2 py-1.5">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">{r.clockIn ?? ""}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.clockOut ?? ""}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.breakStart ?? ""}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.breakEnd ?? ""}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.totalBreak}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.totalInterrupt}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.overtime}</td>
                      <td className="px-2 py-1.5 tabular-nums font-medium">{r.totalWork}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.nightTime}</td>
                    </tr>
                  );
                })}

              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
