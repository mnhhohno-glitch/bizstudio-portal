"use client";

import { useState } from "react";
import TimeComboBox from "./TimeComboBox";

const TAG_OPTIONS = [
  { label: "CA業務", color: "#6B7280" },
  { label: "会議", color: "#0891B2" },
  { label: "来客", color: "#0891B2" },
  { label: "定例", color: "#0891B2" },
  { label: "開発", color: "#2563EB" },
  { label: "開発（軽）", color: "#CA8A04" },
  { label: "経営", color: "#7C3AED" },
  { label: "移動", color: "#9CA3AF" },
  { label: "休憩", color: "#9CA3AF" },
  { label: "最優先", color: "#DC2626" },
  { label: "月末", color: "#EA580C" },
  { label: "その他", color: "#6B7280" },
];

export interface EntryFormData {
  startTime: string;
  endTime: string;
  title: string;
  note: string;
  tag: string;
  tagColor: string;
}

export interface EditEntryData {
  id: string;
  startTime: string;
  endTime: string;
  title: string;
  note?: string | null;
  tag: string;
  tagColor: string;
}

export default function ScheduleEntryFormModal({
  onClose,
  onSaved,
  scheduleId,
  editEntry,
}: {
  onClose: () => void;
  onSaved: () => void;
  scheduleId: string;
  editEntry?: EditEntryData | null;
}) {
  const isEdit = !!editEntry;
  const matchTag = editEntry ? TAG_OPTIONS.find((t) => t.label === editEntry.tag) : null;

  const [startTime, setStartTime] = useState(editEntry?.startTime || "09:00");
  const [endTime, setEndTime] = useState(editEntry?.endTime || "10:00");
  const [title, setTitle] = useState(editEntry?.title || "");
  const [note, setNote] = useState(editEntry?.note || "");
  const [selectedTag, setSelectedTag] = useState(matchTag || TAG_OPTIONS[0]);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSaving(true);

    try {
      if (isEdit && editEntry) {
        await fetch(`/api/schedule/entry/${editEntry.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startTime,
            endTime,
            title: title.trim(),
            note: note.trim() || null,
            tag: selectedTag.label,
            tagColor: selectedTag.color,
          }),
        });
      } else {
        await fetch("/api/schedule/entry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scheduleId,
            startTime,
            endTime,
            title: title.trim(),
            note: note.trim() || null,
            tag: selectedTag.label,
            tagColor: selectedTag.color,
            entryType: "MANUAL",
          }),
        });
      }
      onSaved();
      onClose();
    } catch { /* */ }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-md w-full mx-4 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-bold text-[#374151]">{isEdit ? "エントリを編集" : "エントリを追加"}</h2>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">×</button>
        </div>

        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[12px] font-medium text-[#374151] mb-1">開始時間</label>
              <TimeComboBox value={startTime} onChange={setStartTime} />
            </div>
            <div className="flex-1">
              <label className="block text-[12px] font-medium text-[#374151] mb-1">終了時間</label>
              <TimeComboBox value={endTime} onChange={setEndTime} />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#374151] mb-1">タスク名 *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="タスク名を入力"
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:border-[#2563EB] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#374151] mb-1">メモ</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="補足メモ（任意）"
              rows={2}
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] resize-none focus:border-[#2563EB] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#374151] mb-1">タグ</label>
            <div className="flex flex-wrap gap-1.5">
              {TAG_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setSelectedTag(opt)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors ${
                    selectedTag.label === opt.label
                      ? "text-white border-transparent"
                      : "text-[#374151] border-gray-300 bg-white hover:bg-gray-50"
                  }`}
                  style={selectedTag.label === opt.label ? { backgroundColor: opt.color } : undefined}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-[13px] font-medium hover:bg-gray-50">
            キャンセル
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || saving}
            className="flex-1 bg-[#2563EB] text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? "保存中..." : isEdit ? "更新" : "追加"}
          </button>
        </div>
      </div>
    </div>
  );
}
