"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Toaster } from "sonner";

type AttRecord = {
  id: string;
  date: string;
  status: string;
  clockIn: string | null;
  clockOut: string | null;
  totalWork: number;
  totalBreak: number;
  overtime: number;
  isFinalized: boolean;
  note: string | null;
};

type Leave = {
  id: string;
  date: string;
  leaveType: string;
  halfDay: string | null;
  status: string;
};

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "未出勤",
  WORKING: "勤務中",
  ON_BREAK: "休憩中",
  INTERRUPTED: "中断中",
  FINISHED: "確定済み",
};
const STATUS_COLOR: Record<string, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-600",
  FINISHED: "bg-green-100 text-green-700",
  WORKING: "bg-blue-100 text-blue-700",
};
const LEAVE_LABEL: Record<string, string> = {
  PAID_FULL: "有給",
  PAID_HALF: "有給(半日)",
  OTHER: "その他",
};

function formatTime(ts: string | null): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
}

function formatSec(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

export default function AttendanceHistoryPage() {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [records, setRecords] = useState<AttRecord[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [paidLeave, setPaidLeave] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/attendance/history?month=${month}`)
      .then((r) => r.json())
      .then((data) => {
        setRecords(data.records ?? []);
        setLeaves(data.leaves ?? []);
        setPaidLeave(data.paidLeave ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [month]);

  const leaveMap = new Map(leaves.map((l) => [new Date(l.date).toISOString().split("T")[0], l]));

  // Monthly totals
  const totalWork = records.reduce((sum, r) => sum + r.totalWork, 0);
  const totalOvertime = records.reduce((sum, r) => sum + r.overtime, 0);
  const leaveCount = leaves.filter((l) => l.status === "APPROVED").length;

  return (
    <div className="mx-auto max-w-3xl">
      <Toaster position="top-center" richColors />

      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/attendance" className="text-[14px] text-[#6B7280] hover:text-[#374151]">&larr; 打刻画面</Link>
          <h1 className="text-[18px] font-bold text-[#1E3A8A]">打刻履歴</h1>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 text-[13px]"
        />
      </div>

      {/* Monthly Summary */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-[8px] border border-[#E5E7EB] bg-white p-4 text-center">
          <p className="text-[12px] text-[#6B7280]">実労働時間</p>
          <p className="text-[18px] font-bold text-[#374151]">{formatSec(totalWork)}</p>
        </div>
        <div className="rounded-[8px] border border-[#E5E7EB] bg-white p-4 text-center">
          <p className="text-[12px] text-[#6B7280]">残業時間</p>
          <p className="text-[18px] font-bold text-[#374151]">{formatSec(totalOvertime)}</p>
        </div>
        <div className="rounded-[8px] border border-[#E5E7EB] bg-white p-4 text-center">
          <p className="text-[12px] text-[#6B7280]">有給取得</p>
          <p className="text-[18px] font-bold text-[#374151]">{leaveCount}日<span className="ml-1 text-[12px] text-[#9CA3AF]">/ 残{paidLeave}</span></p>
        </div>
      </div>

      {/* Records Table */}
      <div className="rounded-[8px] border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-[14px] text-[#6B7280]">読み込み中...</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-left text-[12px] font-medium text-[#6B7280]">
                <th className="px-4 py-2">日付</th>
                <th className="px-3 py-2">ステータス</th>
                <th className="px-3 py-2">出勤</th>
                <th className="px-3 py-2">退勤</th>
                <th className="px-3 py-2">実労働</th>
                <th className="px-3 py-2">備考</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 && leaves.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-[#6B7280]">データがありません</td></tr>
              ) : (
                records.map((r) => {
                  const dateStr = new Date(r.date).toISOString().split("T")[0];
                  const d = new Date(r.date);
                  const dayName = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  const leave = leaveMap.get(dateStr);
                  const statusLabel = leave && leave.status === "APPROVED"
                    ? LEAVE_LABEL[leave.leaveType] ?? "休暇"
                    : STATUS_LABEL[r.status] ?? r.status;
                  const statusColor = leave && leave.status === "APPROVED"
                    ? "bg-purple-100 text-purple-700"
                    : STATUS_COLOR[r.status] ?? "bg-gray-100 text-gray-600";

                  return (
                    <tr key={r.id} className={`border-b border-[#F3F4F6] hover:bg-[#F9FAFB] ${isWeekend ? "bg-gray-50" : ""}`}>
                      <td className="px-4 py-2.5">
                        {r.isFinalized ? (
                          <Link href={`/attendance/correction/${dateStr}`} className="text-[#2563EB] hover:underline">
                            {`${d.getMonth() + 1}/${d.getDate()}(${dayName})`}
                          </Link>
                        ) : (
                          <span className={isWeekend ? "text-[#9CA3AF]" : "text-[#374151]"}>
                            {`${d.getMonth() + 1}/${d.getDate()}(${dayName})`}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${statusColor}`}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{formatTime(r.clockIn)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{formatTime(r.clockOut)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{r.totalWork > 0 ? formatSec(r.totalWork) : "-"}</td>
                      <td className="px-3 py-2.5 text-[#6B7280]">{r.note ?? ""}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
