"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ENTRY_ROUTE_OPTIONS } from "@/lib/constants/job-types";
import type { Entry } from "./EntryBoard";

type Props = {
  entry: Entry;
  onClose: () => void;
  onSaved: (updated: Entry) => void;
};

export default function EntryRouteSwitchModal({ entry, onClose, onSaved }: Props) {
  const [entryRoute, setEntryRoute] = useState(entry.entryRoute || "");
  const [entryJobId, setEntryJobId] = useState(entry.entryJobId || "");
  const [jobDbUrl, setJobDbUrl] = useState(entry.jobDbUrl || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryRoute: entryRoute || null,
          entryJobId: entryJobId.trim() || null,
          jobDbUrl: jobDbUrl.trim() || null,
        }),
      });
      if (!res.ok) {
        toast.error("保存に失敗しました");
        return;
      }
      const data = await res.json();
      toast.success("エントリー媒体を更新しました");
      onSaved(data.entry);
    } catch {
      toast.error("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const clear = () => {
    setEntryRoute("");
    setEntryJobId("");
    setJobDbUrl("");
  };

  const inputCls = "w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#2563EB]";
  const labelCls = "block text-[13px] font-medium text-[#374151] mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { if (!saving) onClose(); }}>
      <div className="bg-white rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="border-b px-5 py-3">
          <h2 className="text-[15px] font-bold text-[#374151]">エントリー媒体切替</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">紹介時とは別の媒体でエントリーする場合に使用</p>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="bg-gray-50 rounded-md px-3 py-2 text-[11px] text-gray-600">
            <div>求職者: <span className="font-medium text-gray-800">{entry.candidate.name}</span></div>
            <div>企業: <span className="font-medium text-gray-800">{entry.companyName}</span></div>
            {entry.jobDb && <div>元の媒体: <span className="font-medium text-gray-800">{entry.jobDb}</span></div>}
          </div>

          <div>
            <label className={labelCls}>エントリー媒体</label>
            <select className={inputCls} value={entryRoute} onChange={(e) => setEntryRoute(e.target.value)}>
              <option value="">（切替なし）</option>
              {ENTRY_ROUTE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls}>エントリー先求人ID</label>
            <input
              type="text"
              className={inputCls}
              value={entryJobId}
              onChange={(e) => setEntryJobId(e.target.value)}
              placeholder="例: 2_331553_20"
            />
          </div>

          <div>
            <label className={labelCls}>求人DB URL（任意）</label>
            <input
              type="url"
              className={inputCls}
              value={jobDbUrl}
              onChange={(e) => setJobDbUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
        </div>

        <div className="border-t px-5 py-3 flex gap-2">
          <button
            onClick={clear}
            disabled={saving}
            className="border border-gray-300 bg-white text-gray-600 rounded-md px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            クリア
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            disabled={saving}
            className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
