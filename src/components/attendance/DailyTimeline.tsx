"use client";

import { useState } from "react";
import { toast } from "sonner";

type Punch = {
  id: string;
  type: string;
  timestamp: string;
  isManualEdit: boolean;
};

type Props = {
  punches: Punch[];
  isFinalized: boolean;
};

const TYPE_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  CLOCK_IN: { label: "出勤", icon: "🟢", color: "text-green-700" },
  BREAK_START: { label: "休憩開始", icon: "🔵", color: "text-blue-600" },
  BREAK_END: { label: "休憩終了", icon: "🔵", color: "text-blue-600" },
  INTERRUPT_START: { label: "中断開始", icon: "🟡", color: "text-amber-600" },
  INTERRUPT_END: { label: "中断終了", icon: "🟡", color: "text-amber-600" },
  CLOCK_OUT: { label: "退勤", icon: "🔴", color: "text-red-600" },
};

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
}

function calcPairDuration(startTs: string, endTs: string): string {
  const diff = Math.floor((new Date(endTs).getTime() - new Date(startTs).getTime()) / 1000);
  const m = Math.floor(diff / 60);
  return `${m}分`;
}

export default function DailyTimeline({ punches, isFinalized }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTime, setEditTime] = useState("");
  const [saving, setSaving] = useState(false);

  const handleEdit = (punch: Punch) => {
    const d = new Date(punch.timestamp);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    setEditTime(`${h}:${m}`);
    setEditingId(punch.id);
  };

  const handleSave = async (punchId: string, originalTs: string) => {
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

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "修正に失敗しました");
        return;
      }

      toast.success("打刻時刻を修正しました");
      setEditingId(null);
      window.location.reload();
    } catch {
      toast.error("修正に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (punches.length === 0) {
    return (
      <div className="rounded-[8px] border border-[#E5E7EB] bg-white p-4">
        <p className="text-[13px] text-[#9CA3AF] text-center">本日の打刻はまだありません</p>
      </div>
    );
  }

  // Calculate pair durations
  const breakPairs: { start: string; end: string }[] = [];
  const intPairs: { start: string; end: string }[] = [];
  const breakStarts = punches.filter((p) => p.type === "BREAK_START");
  const breakEnds = punches.filter((p) => p.type === "BREAK_END");
  const intStarts = punches.filter((p) => p.type === "INTERRUPT_START");
  const intEnds = punches.filter((p) => p.type === "INTERRUPT_END");
  for (let i = 0; i < Math.min(breakStarts.length, breakEnds.length); i++) {
    breakPairs.push({ start: breakStarts[i].timestamp, end: breakEnds[i].timestamp });
  }
  for (let i = 0; i < Math.min(intStarts.length, intEnds.length); i++) {
    intPairs.push({ start: intStarts[i].timestamp, end: intEnds[i].timestamp });
  }

  return (
    <div className="rounded-[8px] border border-[#E5E7EB] bg-white">
      <div className="border-b border-[#E5E7EB] px-4 py-3">
        <h3 className="text-[14px] font-bold text-[#374151]">本日のタイムライン</h3>
      </div>
      <div className="divide-y divide-[#F3F4F6]">
        {punches.map((punch) => {
          const config = TYPE_CONFIG[punch.type] ?? { label: punch.type, icon: "⚪", color: "text-gray-600" };
          // Find pair duration for END types
          let pairInfo: string | null = null;
          if (punch.type === "BREAK_END") {
            const pair = breakPairs.find((p) => p.end === punch.timestamp);
            if (pair) pairInfo = calcPairDuration(pair.start, pair.end);
          }
          if (punch.type === "INTERRUPT_END") {
            const pair = intPairs.find((p) => p.end === punch.timestamp);
            if (pair) pairInfo = calcPairDuration(pair.start, pair.end);
          }

          return (
            <div key={punch.id} className="flex items-center gap-3 px-4 py-3">
              <span className="text-[14px]">{config.icon}</span>
              <div className="flex-1 min-w-0">
                {editingId === punch.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                      className="rounded border border-[#D1D5DB] px-2 py-1 text-[14px]"
                    />
                    <button
                      onClick={() => handleSave(punch.id, punch.timestamp)}
                      disabled={saving}
                      className="rounded bg-[#2563EB] px-3 py-1 text-[12px] text-white hover:bg-[#1D4ED8]"
                    >
                      保存
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-[12px] text-[#6B7280] hover:text-[#374151]"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className={`text-[14px] font-medium tabular-nums ${config.color}`}>
                      {formatTime(punch.timestamp)}
                    </span>
                    <span className="text-[13px] text-[#374151]">{config.label}</span>
                    {pairInfo && (
                      <span className="text-[12px] text-[#9CA3AF]">（{pairInfo}）</span>
                    )}
                    {punch.isManualEdit && (
                      <span className="text-[10px] text-[#9CA3AF]">修正済</span>
                    )}
                  </div>
                )}
              </div>
              {!isFinalized && editingId !== punch.id && (
                <button
                  onClick={() => handleEdit(punch)}
                  className="shrink-0 text-[12px] text-[#9CA3AF] hover:text-[#2563EB]"
                >
                  編集
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
