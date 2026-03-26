"use client";

import { useState, useEffect, useCallback } from "react";
import DailyTimeline from "./DailyTimeline";
import ScheduleEntryFormModal from "./ScheduleEntryFormModal";
import type { EntryFormData } from "./ScheduleEntryFormModal";

type ScheduleEntry = {
  id: string;
  startTime: string;
  endTime: string;
  title: string;
  note: string | null;
  tag: string;
  tagColor: string;
  entryType: string;
  sortOrder: number;
};

type Schedule = {
  id: string;
  date: string;
  summary: string | null;
  status: string;
  entries: ScheduleEntry[];
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "下書き",
  CONFIRMED: "確定済み",
  COMPLETED: "完了",
};

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  CONFIRMED: "bg-green-100 text-green-700",
  COMPLETED: "bg-blue-100 text-blue-700",
};

function formatDateLabel(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const w = weekdays[date.getDay()];
  return `${y}年${m}月${d}日（${w}）`;
}

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isToday(date: Date): boolean {
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

export default function SchedulePanel() {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/schedule?date=${toDateString(currentDate)}`);
      if (res.ok) {
        const data = await res.json();
        setSchedule(data.schedule);
      }
    } catch { /* */ }
    finally { setLoading(false); }
  }, [currentDate]);

  useEffect(() => { fetchSchedule(); }, [fetchSchedule]);

  const goToday = () => setCurrentDate(new Date());
  const goTomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    setCurrentDate(d);
  };
  const goPrev = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - 1);
    setCurrentDate(d);
  };
  const goNext = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 1);
    setCurrentDate(d);
  };

  const handleAddEntry = async (data: EntryFormData) => {
    setSaving(true);
    try {
      if (schedule) {
        // Add to existing schedule
        const newEntries = [
          ...schedule.entries.map((e, i) => ({
            startTime: e.startTime,
            endTime: e.endTime,
            title: e.title,
            note: e.note,
            tag: e.tag,
            tagColor: e.tagColor,
            entryType: e.entryType,
            sortOrder: i,
          })),
          {
            startTime: data.startTime,
            endTime: data.endTime,
            title: data.title,
            note: data.note || null,
            tag: data.tag,
            tagColor: data.tagColor,
            entryType: "MANUAL",
            sortOrder: schedule.entries.length,
          },
        ];
        // Sort by startTime
        newEntries.sort((a, b) => a.startTime.localeCompare(b.startTime));
        newEntries.forEach((e, i) => (e.sortOrder = i));

        await fetch(`/api/schedule/${schedule.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: newEntries }),
        });
      } else {
        // Create new schedule
        await fetch("/api/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: toDateString(currentDate),
            entries: [{
              startTime: data.startTime,
              endTime: data.endTime,
              title: data.title,
              note: data.note || null,
              tag: data.tag,
              tagColor: data.tagColor,
              entryType: "MANUAL",
              sortOrder: 0,
            }],
          }),
        });
      }
      setShowAddModal(false);
      fetchSchedule();
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!schedule) return;
    if (!confirm("このスケジュールを削除しますか？")) return;
    setDeleting(true);
    try {
      await fetch(`/api/schedule/${schedule.id}`, { method: "DELETE" });
      setSchedule(null);
    } catch { /* */ }
    finally { setDeleting(false); }
  };

  const handleStatusChange = async () => {
    if (!schedule) return;
    const nextStatus = schedule.status === "DRAFT" ? "CONFIRMED" : schedule.status === "CONFIRMED" ? "COMPLETED" : null;
    if (!nextStatus) return;
    try {
      await fetch(`/api/schedule/${schedule.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      fetchSchedule();
    } catch { /* */ }
  };

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#E5E7EB]">
        <h2 className="text-[14px] font-medium text-[#374151] flex items-center gap-1.5">
          📅 今日のスケジュール
        </h2>
        {/* Date navigation */}
        <div className="flex items-center gap-2 mt-2">
          <button onClick={goToday} className={`text-[11px] px-2 py-0.5 rounded-md border ${isToday(currentDate) ? "bg-[#2563EB] text-white border-[#2563EB]" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
            今日
          </button>
          <button onClick={goTomorrow} className="text-[11px] px-2 py-0.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50">
            明日
          </button>
          <div className="flex items-center gap-1 ml-auto">
            <button onClick={goPrev} className="text-[#6B7280] hover:text-[#374151] text-[14px]">◀</button>
            <span className="text-[12px] text-[#374151] font-medium">{formatDateLabel(currentDate)}</span>
            <button onClick={goNext} className="text-[#6B7280] hover:text-[#374151] text-[14px]">▶</button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        {loading ? (
          <div className="py-8 text-center text-[13px] text-[#9CA3AF]">読み込み中...</div>
        ) : (
          <>
            <DailyTimeline
              entries={(schedule?.entries || []).map((e) => ({
                startTime: e.startTime,
                endTime: e.endTime,
                title: e.title,
                note: e.note,
                tag: e.tag,
                tagColor: e.tagColor,
              }))}
              summary={schedule?.summary}
            />

            {/* Status + actions */}
            {schedule && (
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[schedule.status] || ""}`}>
                    {STATUS_LABEL[schedule.status] || schedule.status}
                  </span>
                  {schedule.status !== "COMPLETED" && (
                    <button
                      onClick={handleStatusChange}
                      className="text-[11px] text-[#2563EB] hover:underline"
                    >
                      {schedule.status === "DRAFT" ? "確定する" : "完了にする"}
                    </button>
                  )}
                </div>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-[11px] text-red-400 hover:text-red-600 disabled:opacity-50"
                >
                  削除
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer actions */}
      <div className="px-4 py-3 border-t border-[#E5E7EB] space-y-2">
        <button
          disabled
          title="Phase 2 で有効化予定"
          className="w-full rounded-md bg-gray-100 px-3 py-2 text-[13px] font-medium text-gray-400 cursor-not-allowed"
        >
          ✏️ AIでスケジュール作成
        </button>
        <button
          onClick={() => setShowAddModal(true)}
          className="w-full rounded-md border border-[#2563EB] text-[#2563EB] px-3 py-2 text-[13px] font-medium hover:bg-blue-50 transition-colors"
        >
          + エントリを追加
        </button>
      </div>

      {showAddModal && (
        <ScheduleEntryFormModal
          onClose={() => setShowAddModal(false)}
          onSave={handleAddEntry}
          saving={saving}
        />
      )}
    </div>
  );
}
