"use client";

import { useState } from "react";

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

function generateTimeOptions(): string[] {
  const times: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) {
      times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return times;
}

const TIME_OPTIONS = generateTimeOptions();

export interface EntryFormData {
  startTime: string;
  endTime: string;
  title: string;
  note: string;
  tag: string;
  tagColor: string;
}

export default function ScheduleEntryFormModal({
  onClose,
  onSave,
  saving,
}: {
  onClose: () => void;
  onSave: (data: EntryFormData) => void;
  saving: boolean;
}) {
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [selectedTag, setSelectedTag] = useState(TAG_OPTIONS[0]);

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSave({
      startTime,
      endTime,
      title: title.trim(),
      note: note.trim(),
      tag: selectedTag.label,
      tagColor: selectedTag.color,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-md w-full mx-4 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-bold text-[#374151]">エントリを追加</h2>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">×</button>
        </div>

        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[12px] font-medium text-[#374151] mb-1">開始時間</label>
              <select value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-[13px]">
                {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[12px] font-medium text-[#374151] mb-1">終了時間</label>
              <select value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-[13px]">
                {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
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
            {saving ? "保存中..." : "追加"}
          </button>
        </div>
      </div>
    </div>
  );
}
