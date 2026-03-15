"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Toaster, toast } from "sonner";
import { getAvailableActions } from "@/lib/attendance/state";
import type { AttendanceStatus, PunchType } from "@prisma/client";
import TimeDisplay from "@/components/attendance/TimeDisplay";
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
    totalInterrupt: number;
    overtime: number;
  } | null;
  punches: { id: string; type: string; timestamp: string; isManualEdit: boolean }[];
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  NOT_STARTED: { label: "未出勤", color: "bg-gray-100 text-gray-600" },
  WORKING: { label: "勤務中", color: "bg-green-100 text-green-800" },
  ON_BREAK: { label: "休憩中", color: "bg-blue-100 text-blue-800" },
  INTERRUPTED: { label: "中断中", color: "bg-amber-100 text-amber-800" },
  FINISHED: { label: "退勤済み", color: "bg-gray-100 text-gray-600" },
};

const PUNCH_CONFIG: Record<string, { label: string; bg: string; dot: string }> = {
  CLOCK_IN: { label: "出勤", bg: "bg-green-600 hover:bg-green-700", dot: "bg-green-500" },
  BREAK_START: { label: "休憩開始", bg: "bg-blue-500 hover:bg-blue-600", dot: "bg-blue-500" },
  BREAK_END: { label: "休憩終了", bg: "bg-blue-500 hover:bg-blue-600", dot: "bg-blue-500" },
  INTERRUPT_START: { label: "中断開始", bg: "bg-amber-500 hover:bg-amber-600", dot: "bg-amber-500" },
  INTERRUPT_END: { label: "中断終了", bg: "bg-amber-500 hover:bg-amber-600", dot: "bg-amber-500" },
  CLOCK_OUT: { label: "退勤", bg: "bg-red-500 hover:bg-red-600", dot: "bg-red-500" },
};

function formatSec(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
}

export default function AttendancePage() {
  const [data, setData] = useState<AttendanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [punching, setPunching] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{ code: string; message: string }[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTime, setEditTime] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(() => {
    fetch("/api/attendance/status")
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handlePunch = async (punchType: PunchType) => {
    const now = new Date().toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
    const label = PUNCH_CONFIG[punchType]?.label ?? punchType;
    if (!confirm(`${now} に${label}を打刻しますか？`)) return;

    setPunching(true);
    setValidationErrors(null);
    try {
      const res = await fetch("/api/attendance/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ punchType }),
      });
      const d = await res.json();
      if (!res.ok) {
        if (d.validationErrors) { setValidationErrors(d.validationErrors); }
        else { toast.error(d.error || "打刻に失敗しました"); }
        return;
      }
      toast.success(`${label}を打刻しました`);
      fetchData();
    } catch { toast.error("打刻に失敗しました"); }
    finally { setPunching(false); }
  };

  const handleEditSave = async (punchId: string, originalTs: string) => {
    if (!editTime) return;
    setSaving(true);
    try {
      const orig = new Date(originalTs);
      const [h, m] = editTime.split(":").map(Number);
      const newTs = new Date(orig);
      newTs.setHours(h, m, 0, 0);
      const res = await fetch("/api/attendance/punch/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ punchEventId: punchId, newTimestamp: newTs.toISOString() }),
      });
      if (!res.ok) { const d = await res.json(); toast.error(d.error); return; }
      toast.success("打刻時刻を修正しました");
      setEditingId(null);
      fetchData();
    } catch { toast.error("修正に失敗しました"); }
    finally { setSaving(false); }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-[14px] text-[#6B7280]">読み込み中...</div>;
  }
  if (!data?.employee) {
    return <div className="py-20 text-center"><p className="text-[14px] text-[#6B7280]">社員情報が見つかりません</p></div>;
  }

  const status = (data.attendance?.status ?? "NOT_STARTED") as AttendanceStatus;
  const available = getAvailableActions(status);
  const statusCfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.NOT_STARTED;
  const isFinalized = data.attendance?.isFinalized ?? false;
  const clockInStr = data.attendance?.clockIn
    ? new Date(data.attendance.clockIn).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div>
      <Toaster position="top-center" richColors />

      {/* Alert Banner (full width) */}
      <AlertBanner />

      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-[18px] font-bold text-[#1E3A8A]">勤怠管理</h1>
        <div className="flex gap-2">
          <Link href="/attendance/history" className="rounded-lg border border-[#D1D5DB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F3F4F6]">履歴</Link>
          <Link href="/attendance/leave" className="rounded-lg border border-[#D1D5DB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F3F4F6]">休暇申請</Link>
          {data.userRole === "admin" && (
            <Link href="/attendance/admin" className="rounded-lg bg-[#2563EB] px-3 py-1.5 text-[13px] text-white hover:bg-[#1D4ED8]">管理者</Link>
          )}
        </div>
      </div>

      {/* 2-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left column */}
        <div className="space-y-4">
          {/* Time + Status Card */}
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
            <TimeDisplay />
            <div className="mt-4 flex flex-col items-center gap-2">
              <span className={`inline-block rounded-full px-4 py-1.5 text-[14px] font-medium ${statusCfg.color}`}>
                {statusCfg.label}
              </span>
              {clockInStr && <p className="text-[13px] text-[#6B7280]">出勤: {clockInStr}</p>}
            </div>
          </div>

          {/* Punch Buttons Card */}
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
            {status === "NOT_STARTED" ? (
              <button
                type="button"
                disabled={!available.includes("CLOCK_IN") || punching}
                onClick={() => handlePunch("CLOCK_IN")}
                className="w-full h-12 rounded-lg bg-green-600 text-[15px] font-bold text-white hover:bg-green-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {punching ? "..." : "出勤"}
              </button>
            ) : status === "FINISHED" ? (
              <p className="text-center text-[14px] text-[#6B7280] py-2">本日の勤務は終了しました</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {(["BREAK_START", "BREAK_END", "INTERRUPT_START", "INTERRUPT_END"] as PunchType[]).map((type) => {
                    const cfg = PUNCH_CONFIG[type];
                    const isActive = available.includes(type);
                    return (
                      <button
                        key={type}
                        type="button"
                        disabled={!isActive || punching}
                        onClick={() => handlePunch(type)}
                        className={`h-11 rounded-lg text-[14px] font-medium text-white transition-all active:scale-[0.98] ${
                          isActive ? cfg.bg : "bg-gray-200 text-gray-400 cursor-not-allowed"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2">
                  <button
                    type="button"
                    disabled={!available.includes("CLOCK_OUT") || punching}
                    onClick={() => handlePunch("CLOCK_OUT")}
                    className={`w-full h-11 rounded-lg text-[14px] font-medium text-white transition-all active:scale-[0.98] ${
                      available.includes("CLOCK_OUT") ? "bg-red-500 hover:bg-red-600" : "bg-gray-200 text-gray-400 cursor-not-allowed"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    退勤
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right column */}
        <div>
          <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] h-full flex flex-col">
            {/* Timeline */}
            <div className="px-4 py-3 border-b border-[#E5E7EB]">
              <h3 className="text-[14px] font-bold text-[#374151]">本日のタイムライン</h3>
            </div>
            <div className="flex-1 divide-y divide-gray-100">
              {data.punches.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] text-[#9CA3AF]">打刻はまだありません</p>
              ) : (
                data.punches.map((p) => {
                  const cfg = PUNCH_CONFIG[p.type] ?? { label: p.type, dot: "bg-gray-400" };
                  return (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${cfg.dot}`} />
                      <div className="flex-1 min-w-0">
                        {editingId === p.id ? (
                          <div className="flex items-center gap-2">
                            <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)}
                              className="rounded border border-[#D1D5DB] px-2 py-1 text-[13px]" />
                            <button onClick={() => handleEditSave(p.id, p.timestamp)} disabled={saving}
                              className="rounded bg-[#2563EB] px-2.5 py-1 text-[12px] text-white">保存</button>
                            <button onClick={() => setEditingId(null)} className="text-[12px] text-[#6B7280]">取消</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-[14px] font-medium tabular-nums">{formatTime(p.timestamp)}</span>
                            <span className="text-[13px] text-[#374151]">{cfg.label}</span>
                            {p.isManualEdit && <span className="text-[10px] text-[#9CA3AF]">修正済</span>}
                          </div>
                        )}
                      </div>
                      {!isFinalized && editingId !== p.id && (
                        <button
                          onClick={() => { setEditTime(formatTime(p.timestamp)); setEditingId(p.id); }}
                          className="shrink-0 text-[12px] text-[#9CA3AF] hover:text-[#2563EB]"
                        >
                          編集
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Summary */}
            {data.punches.length > 0 && (
              <div className="border-t border-[#E5E7EB] px-4 py-3">
                <h4 className="mb-2 text-[12px] font-medium text-[#6B7280]">本日のサマリ</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div>
                    <p className="text-[11px] text-[#9CA3AF]">勤務時間</p>
                    <p className="text-[15px] font-medium tabular-nums text-[#374151]">{formatSec(data.attendance?.totalWork ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[#9CA3AF]">休憩合計</p>
                    <p className="text-[15px] font-medium tabular-nums text-[#374151]">{formatSec(data.attendance?.totalBreak ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[#9CA3AF]">中断合計</p>
                    <p className="text-[15px] font-medium tabular-nums text-[#374151]">{formatSec(data.attendance?.totalInterrupt ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[#9CA3AF]">残業</p>
                    <p className="text-[15px] font-medium tabular-nums text-[#374151]">
                      {(data.attendance?.overtime ?? 0) > 0 ? formatSec(data.attendance!.overtime) : "-"}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Validation Error Modal */}
      {validationErrors && validationErrors.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-[16px] font-bold text-red-600">退勤できません</h3>
            <div className="space-y-3 mb-6">
              {validationErrors.map((err, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-red-50 p-3">
                  <span className="text-red-500 shrink-0 font-bold">!</span>
                  <p className="text-[14px] text-red-700">{err.message}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              {validationErrors.some((e) => e.code === "BREAK_NOT_ENDED") && (
                <button onClick={() => { setValidationErrors(null); handlePunch("BREAK_END"); }}
                  className="h-11 rounded-lg bg-blue-500 text-white font-bold hover:bg-blue-600">休憩終了を打刻</button>
              )}
              {validationErrors.some((e) => e.code === "INTERRUPT_NOT_ENDED") && (
                <button onClick={() => { setValidationErrors(null); handlePunch("INTERRUPT_END"); }}
                  className="h-11 rounded-lg bg-amber-500 text-white font-bold hover:bg-amber-600">中断終了を打刻</button>
              )}
              <button onClick={() => setValidationErrors(null)}
                className="h-10 rounded-lg border border-[#E5E7EB] text-[14px] text-[#374151] hover:bg-[#F9FAFB]">閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
