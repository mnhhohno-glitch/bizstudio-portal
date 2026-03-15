"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Toaster } from "sonner";
import { getAvailableActions } from "@/lib/attendance/state";
import type { AttendanceStatus } from "@prisma/client";
import TimeDisplay from "@/components/attendance/TimeDisplay";
import StatusBadge from "@/components/attendance/StatusBadge";
import PunchPanel from "@/components/attendance/PunchPanel";
import DailyTimeline from "@/components/attendance/DailyTimeline";
import AlertBanner from "@/components/attendance/AlertBanner";

type AttendanceData = {
  employee: { id: string; name: string } | null;
  userRole?: string;
  attendance: {
    id: string;
    status: string;
    clockIn: string | null;
    clockOut: string | null;
    isFinalized: boolean;
    totalWork: number;
    totalBreak: number;
  } | null;
  punches: { id: string; type: string; timestamp: string; isManualEdit: boolean }[];
};

export default function AttendancePage() {
  const [data, setData] = useState<AttendanceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/attendance/status")
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[14px] text-[#6B7280]">
        読み込み中...
      </div>
    );
  }

  if (!data?.employee) {
    return (
      <div className="py-20 text-center">
        <p className="text-[14px] text-[#6B7280]">社員情報が見つかりません</p>
      </div>
    );
  }

  const status = (data.attendance?.status ?? "NOT_STARTED") as AttendanceStatus;
  const available = getAvailableActions(status);

  return (
    <div className="mx-auto max-w-lg">
      <Toaster position="top-center" richColors />

      <AlertBanner />

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[18px] font-bold text-[#1E3A8A]">勤怠管理</h1>
        <div className="flex gap-2">
          <Link
            href="/attendance/history"
            className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F3F4F6]"
          >
            履歴
          </Link>
          <Link
            href="/attendance/leave"
            className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F3F4F6]"
          >
            休暇申請
          </Link>
          {data?.userRole === "admin" && (
            <Link
              href="/attendance/admin"
              className="rounded-[6px] bg-[#2563EB] px-3 py-1.5 text-[13px] text-white hover:bg-[#1D4ED8]"
            >
              管理者
            </Link>
          )}
        </div>
      </div>

      {/* Time Display */}
      <div className="mb-6 rounded-[8px] border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        <TimeDisplay />
      </div>

      {/* Status Badge */}
      <div className="mb-6">
        <StatusBadge
          status={status}
          clockIn={data.attendance?.clockIn}
        />
      </div>

      {/* Punch Buttons */}
      <div className="mb-6">
        <PunchPanel status={status} availableActions={available} />
      </div>

      {/* Daily Timeline */}
      <DailyTimeline
        punches={data.punches}
        isFinalized={data.attendance?.isFinalized ?? false}
      />

      {/* Summary (when finalized) */}
      {data.attendance?.isFinalized && (
        <div className="mt-4 rounded-[8px] border border-[#E5E7EB] bg-white p-4">
          <h3 className="mb-2 text-[14px] font-bold text-[#374151]">本日のサマリ</h3>
          <div className="grid grid-cols-2 gap-2 text-[13px]">
            <div className="text-[#6B7280]">実労働時間</div>
            <div className="text-[#374151] font-medium">{formatSec(data.attendance.totalWork)}</div>
            <div className="text-[#6B7280]">休憩時間</div>
            <div className="text-[#374151] font-medium">{formatSec(data.attendance.totalBreak)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatSec(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}時間${m}分`;
}
