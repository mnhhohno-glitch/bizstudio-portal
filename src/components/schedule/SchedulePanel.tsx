"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import DailyTimeline from "./DailyTimeline";
import ScheduleEntryFormModal from "./ScheduleEntryFormModal";
import ScheduleChatDrawer from "./ScheduleChatDrawer";
import ScheduleReviewDrawer from "./ScheduleReviewDrawer";
import ScheduleProgressBar from "./ScheduleProgressBar";
import CalendarConnectButton from "./CalendarConnectButton";
import type { EditEntryData } from "./ScheduleEntryFormModal";

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
  isCompleted: boolean;
  completedAt: string | null;
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

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(minutes, 23 * 60 + 59));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function isToday(date: Date): boolean {
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

export default function SchedulePanel() {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<EditEntryData | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showChatDrawer, setShowChatDrawer] = useState(false);
  const [showReviewDrawer, setShowReviewDrawer] = useState(false);
  const [tomorrowCalendarEvents, setTomorrowCalendarEvents] = useState<{ summary: string; start: string; end: string }[]>([]);
  const [isCalendarConnected, setIsCalendarConnected] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<{ id: string; summary: string; start: string; end: string }[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null);

  const fetchCalendarEvents = useCallback(async () => {
    try {
      const res = await fetch(`/api/calendar/events?date=${toDateString(currentDate)}`);
      if (res.ok) {
        const data = await res.json();
        setIsCalendarConnected(data.connected);
        setCalendarEvents(data.events || []);
      }
    } catch { /* */ }
  }, [currentDate]);

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
  useEffect(() => { fetchCalendarEvents(); }, [fetchCalendarEvents]);

  // Warn before leaving if schedule is DRAFT with entries
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (schedule && schedule.status === "DRAFT" && schedule.entries.length > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [schedule]);

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

  const handleEntrySaved = () => {
    fetchSchedule();
  };

  const handleEditEntry = (entryId: string) => {
    const entry = schedule?.entries.find((e) => e.id === entryId);
    if (!entry) return;
    setEditingEntry({
      id: entry.id,
      startTime: entry.startTime,
      endTime: entry.endTime,
      title: entry.title,
      note: entry.note,
      tag: entry.tag,
      tagColor: entry.tagColor,
    });
    setShowEntryModal(true);
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm("このエントリを削除しますか？")) return;
    try {
      await fetch(`/api/schedule/entry/${entryId}`, { method: "DELETE" });
      fetchSchedule();
    } catch { /* */ }
  };

  const handleOpenAddModal = async () => {
    if (!schedule) {
      // Create schedule first if it doesn't exist
      try {
        const res = await fetch("/api/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: toDateString(currentDate), entries: [] }),
        });
        if (res.ok) {
          await fetchSchedule();
        }
      } catch { /* */ }
    }
    setEditingEntry(null);
    setShowEntryModal(true);
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

  const handleAiSave = async (entries: { startTime: string; endTime: string; title: string; note?: string | null; tag: string; tagColor: string; sortOrder: number }[], summary: string) => {
    try {
      const formattedEntries = entries.map((e, i) => ({
        startTime: e.startTime,
        endTime: e.endTime,
        title: e.title,
        note: e.note || null,
        tag: e.tag,
        tagColor: e.tagColor,
        entryType: "AI_GENERATED",
        sortOrder: e.sortOrder ?? i,
      }));

      if (schedule) {
        await fetch(`/api/schedule/${schedule.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary, entries: formattedEntries }),
        });
      } else {
        await fetch("/api/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: toDateString(currentDate),
            summary,
            entries: formattedEntries,
          }),
        });
      }
      setShowChatDrawer(false);
      fetchSchedule();
    } catch { /* */ }
  };

  const handleToggleComplete = async (entryId: string) => {
    if (!schedule) return;
    const entry = schedule.entries.find((e) => e.id === entryId);
    if (!entry) return;
    // Optimistic update
    setSchedule({
      ...schedule,
      entries: schedule.entries.map((e) =>
        e.id === entryId ? { ...e, isCompleted: !e.isCompleted } : e
      ),
    });
    try {
      await fetch(`/api/schedule/entry/${entryId}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCompleted: !entry.isCompleted }),
      });
    } catch {
      // Rollback
      setSchedule((prev) => prev ? {
        ...prev,
        entries: prev.entries.map((e) =>
          e.id === entryId ? { ...e, isCompleted: entry.isCompleted } : e
        ),
      } : prev);
    }
  };

  const handleOpenReview = async () => {
    // Fetch tomorrow's calendar events
    const tomorrow = new Date(currentDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    try {
      const res = await fetch(`/api/calendar/events?date=${toDateString(tomorrow)}`);
      if (res.ok) {
        const data = await res.json();
        setTomorrowCalendarEvents(data.events || []);
      }
    } catch { /* */ }
    setShowReviewDrawer(true);
  };

  const handleReviewSave = async (review: string, tomorrowEntries: { startTime: string; endTime: string; title: string; note?: string | null; tag: string; tagColor: string; sortOrder: number }[], tomorrowSummary: string) => {
    if (!schedule) return;
    const tomorrow = new Date(currentDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    try {
      await fetch("/api/schedule/review/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          todayScheduleId: schedule.id,
          review,
          tomorrowDate: tomorrowEntries.length > 0 ? toDateString(tomorrow) : undefined,
          tomorrowSummary: tomorrowEntries.length > 0 ? tomorrowSummary : undefined,
          tomorrowEntries: tomorrowEntries.length > 0 ? tomorrowEntries : undefined,
        }),
      });
      setShowReviewDrawer(false);
      fetchSchedule();
    } catch { /* */ }
  };

  const handleReorder = async (activeId: string, overId: string) => {
    if (!schedule) return;
    const entries = [...schedule.entries].sort((a, b) => a.startTime.localeCompare(b.startTime));
    const oldIndex = entries.findIndex((e) => e.id === activeId);
    const overIndex = entries.findIndex((e) => e.id === overId);
    if (oldIndex === -1 || overIndex === -1) return;

    const moved = entries[oldIndex];
    const reordered = arrayMove(entries, oldIndex, overIndex);

    // Calculate new start time based on drop position
    const duration = timeToMinutes(moved.endTime) - timeToMinutes(moved.startTime);
    let newStartMinutes: number;

    if (overIndex === 0) {
      // Dropped at top: use the first entry's start time
      newStartMinutes = timeToMinutes(reordered[1]?.startTime ?? moved.startTime);
      // If the first entry after us starts earlier, put us before it
      if (reordered[1]) {
        newStartMinutes = timeToMinutes(reordered[1].startTime) - duration;
        if (newStartMinutes < 0) newStartMinutes = 0;
      }
    } else {
      // Dropped after another entry: start = previous entry's end time
      const prev = reordered[overIndex - 1];
      newStartMinutes = prev.id === moved.id
        ? timeToMinutes(reordered[overIndex]?.endTime ?? moved.startTime)
        : timeToMinutes(prev.endTime);
    }

    const newStartTime = minutesToTime(newStartMinutes);
    const newEndTime = minutesToTime(newStartMinutes + duration);

    // Optimistic UI update
    setSchedule({
      ...schedule,
      entries: schedule.entries.map((e) =>
        e.id === activeId ? { ...e, startTime: newStartTime, endTime: newEndTime } : e
      ),
    });

    // Persist to DB
    try {
      await fetch(`/api/schedule/entry/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime: newStartTime, endTime: newEndTime }),
      });
    } catch {
      // Rollback
      fetchSchedule();
    }
  };

  const handleSyncCalendar = async () => {
    if (!schedule || syncing) return;
    if (!confirm("現在のスケジュールをGoogleカレンダーに同期しますか？")) return;

    setSyncing(true);
    setSyncProgress({ current: 0, total: schedule.entries.length });

    try {
      const res = await fetch(`/api/schedule/${schedule.id}/sync-calendar`, {
        method: "POST",
      });
      const data = await res.json();
      setSyncProgress(null);

      if (data.errors > 0) {
        alert(`${data.synced}件を同期しました（新規: ${data.created}件、更新: ${data.updated}件、エラー: ${data.errors}件）`);
      } else {
        alert(`${data.synced}件を同期しました（新規: ${data.created}件、更新: ${data.updated}件）`);
      }
      fetchSchedule();
    } catch {
      alert("同期に失敗しました");
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
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
        <div className="mt-2">
          <CalendarConnectButton
            isConnected={isCalendarConnected}
            onConnect={async () => {
              try {
                const res = await fetch("/api/calendar/auth");
                const data = await res.json();
                if (data.authUrl) window.location.href = data.authUrl;
              } catch { /* */ }
            }}
            onDisconnect={() => {
              setIsCalendarConnected(false);
              setCalendarEvents([]);
            }}
          />
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        {loading ? (
          <div className="py-8 text-center text-[13px] text-[#9CA3AF]">読み込み中...</div>
        ) : (
          <>
            {/* DRAFT warning banner */}
            {schedule && schedule.status === "DRAFT" && schedule.entries.length > 0 && (
              <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2">
                <span className="text-[12px] text-yellow-800">⚠️ スケジュールが確定されていません</span>
                <button
                  onClick={handleStatusChange}
                  className="shrink-0 rounded-md bg-[#2563EB] px-3 py-1 text-[12px] font-medium text-white hover:bg-[#1D4ED8]"
                >
                  ✅ 確定する
                </button>
              </div>
            )}
            {schedule && schedule.status === "CONFIRMED" && (
              <ScheduleProgressBar
                completed={schedule.entries.filter((e) => e.isCompleted).length}
                total={schedule.entries.length}
              />
            )}
            <DailyTimeline
              entries={[...(schedule?.entries || [])].sort((a, b) => a.startTime.localeCompare(b.startTime)).map((e) => ({
                startTime: e.startTime,
                endTime: e.endTime,
                title: e.title,
                note: e.note,
                tag: e.tag,
                tagColor: e.tagColor,
                isCompleted: e.isCompleted,
                entryId: e.id,
                canComplete: schedule?.status === "CONFIRMED",
                canEdit: schedule?.status === "CONFIRMED" || schedule?.status === "DRAFT",
                onToggleComplete: handleToggleComplete,
                onEdit: handleEditEntry,
                onDelete: handleDeleteEntry,
              }))}
              isToday={isToday(currentDate)}
              onReorder={schedule?.status !== "COMPLETED" ? handleReorder : undefined}
            />

            {/* Status + actions */}
            {schedule && (
              <div className="mt-3 flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[schedule.status] || ""}`}>
                  {schedule.status === "DRAFT" ? "📝 下書き" : schedule.status === "CONFIRMED" ? "✅ 確定済み" : "🏁 完了"}
                </span>
                {schedule.status === "DRAFT" && schedule.entries.length > 0 && (
                  <button
                    onClick={handleStatusChange}
                    className="rounded-full border border-[#2563EB] px-2.5 py-0.5 text-[11px] font-medium text-[#2563EB] hover:bg-blue-50"
                  >
                    ✅ 確定する
                  </button>
                )}
                {schedule.status === "CONFIRMED" && (
                  <button
                    onClick={handleStatusChange}
                    className="rounded-full border border-[#2563EB] px-2.5 py-0.5 text-[11px] font-medium text-[#2563EB] hover:bg-blue-50"
                  >
                    🏁 完了にする
                  </button>
                )}
                {schedule.status !== "COMPLETED" && (
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="ml-auto text-[11px] text-red-400 hover:text-red-600 disabled:opacity-50"
                  >
                    🗑 削除
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer actions */}
      <div className="px-4 py-3 border-t border-[#E5E7EB] space-y-2">
        {isCalendarConnected && schedule && schedule.entries.length > 0 && schedule.status !== "COMPLETED" && (
          <button
            onClick={handleSyncCalendar}
            disabled={syncing}
            className="w-full rounded-md border border-green-600 text-green-700 px-3 py-2 text-[13px] font-medium hover:bg-green-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncing
              ? syncProgress
                ? `同期中... ${syncProgress.current}/${syncProgress.total}件`
                : "同期中..."
              : "📅 Googleカレンダーに同期"}
          </button>
        )}
        <button
          onClick={() => setShowChatDrawer(true)}
          className="w-full rounded-md bg-[#2563EB] text-white px-3 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors"
        >
          ✏️ AIでスケジュール作成
        </button>
        <button
          onClick={handleOpenAddModal}
          className="w-full rounded-md border border-[#2563EB] text-[#2563EB] px-3 py-2 text-[13px] font-medium hover:bg-blue-50 transition-colors"
        >
          + エントリを追加
        </button>
        {schedule && schedule.status === "CONFIRMED" && (
          <button
            onClick={handleOpenReview}
            className="w-full rounded-md bg-[#374151] text-white px-3 py-2 text-[13px] font-medium hover:bg-[#1F2937] transition-colors"
          >
            🌙 1日を振り返る
          </button>
        )}
      </div>

      {showEntryModal && schedule && (
        <ScheduleEntryFormModal
          onClose={() => { setShowEntryModal(false); setEditingEntry(null); }}
          onSaved={handleEntrySaved}
          scheduleId={schedule.id}
          editEntry={editingEntry}
        />
      )}

      <ScheduleChatDrawer
        isOpen={showChatDrawer}
        onClose={() => setShowChatDrawer(false)}
        date={toDateString(currentDate)}
        scheduleId={schedule?.id || null}
        existingEntries={(schedule?.entries || []).map((e) => ({
          startTime: e.startTime,
          endTime: e.endTime,
          title: e.title,
          note: e.note,
          tag: e.tag,
          tagColor: e.tagColor,
          sortOrder: e.sortOrder,
        }))}
        calendarEvents={calendarEvents}
        onSave={handleAiSave}
      />

      {schedule && (
        <ScheduleReviewDrawer
          isOpen={showReviewDrawer}
          onClose={() => setShowReviewDrawer(false)}
          date={toDateString(currentDate)}
          scheduleId={schedule.id}
          todayEntries={schedule.entries.map((e) => ({
            id: e.id,
            title: e.title,
            isCompleted: e.isCompleted,
            startTime: e.startTime,
            endTime: e.endTime,
            tag: e.tag,
            tagColor: e.tagColor,
          }))}
          tomorrowCalendarEvents={tomorrowCalendarEvents}
          onSave={handleReviewSave}
        />
      )}
    </div>
  );
}
