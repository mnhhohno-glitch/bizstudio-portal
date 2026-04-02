"use client";

import { useState } from "react";
import { toast } from "sonner";
import { SUPPORT_END_REASONS } from "@/lib/constants/support-end-reasons";

type Props = {
  candidateId: string;
  onClose: () => void;
  onSaved: () => void;
};

export default function SupportEndModal({ candidateId, onClose, onSaved }: Props) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!reason) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supportStatus: "ENDED",
          supportEndReason: reason,
          supportEndNote: reason === "OTHER" ? note.trim() : null,
          supportEndDate: endDate,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("支援終了に変更しました");
      onSaved();
      onClose();
    } catch {
      toast.error("更新に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="border-b px-5 py-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-[#374151]">支援終了理由の選択</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-2">終了理由</label>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {SUPPORT_END_REASONS.map((r) => (
                <label key={r.code} className="flex items-center gap-2 text-[13px] cursor-pointer hover:bg-gray-50 rounded px-2 py-1">
                  <input type="radio" name="endReason" value={r.code} checked={reason === r.code} onChange={() => setReason(r.code)} className="accent-[#2563EB]" />
                  {r.label}
                </label>
              ))}
            </div>
          </div>
          {reason === "OTHER" && (
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1">詳細（自由記述）</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none resize-none"
                placeholder="終了理由の詳細を入力してください"
              />
            </div>
          )}
          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">終了日</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
            />
          </div>
        </div>
        <div className="border-t px-5 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-sm hover:bg-gray-50">キャンセル</button>
          <button onClick={handleSave} disabled={!reason || saving} className="flex-1 bg-red-600 text-white rounded-md px-3 py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50">
            {saving ? "更新中..." : "支援終了に変更"}
          </button>
        </div>
      </div>
    </div>
  );
}
