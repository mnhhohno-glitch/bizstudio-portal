"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { FlagData } from "./EntryBoard";

type Props = {
  selectedCount: number;
  selectedIds: string[];
  flagData: FlagData;
  onClose: () => void;
  onDone: () => void;
};

const NO_CHANGE = "__no_change__";

export default function BulkFlagChangeModal({ selectedCount, selectedIds, flagData, onClose, onDone }: Props) {
  const [entryFlag, setEntryFlag] = useState(NO_CHANGE);
  const [entryFlagDetail, setEntryFlagDetail] = useState(NO_CHANGE);
  const [companyFlag, setCompanyFlag] = useState(NO_CHANGE);
  const [personFlag, setPersonFlag] = useState(NO_CHANGE);
  const [saving, setSaving] = useState(false);

  const entryFlagOptions = flagData.entryFlags.filter((f) => f !== "応募");
  const detailOptions = entryFlag !== NO_CHANGE ? (flagData.entryDetails[entryFlag] || []) : [];
  const companyOptions = entryFlag !== NO_CHANGE ? (flagData.companyFlags[entryFlag] || []) : [];
  const personOptions = entryFlag !== NO_CHANGE ? (flagData.personFlags[entryFlag] || []) : [];

  const handleEntryFlagChange = (val: string) => {
    setEntryFlag(val);
    setEntryFlagDetail(NO_CHANGE);
    setCompanyFlag(NO_CHANGE);
    setPersonFlag(NO_CHANGE);
  };

  const handleSubmit = async () => {
    if (!confirm(`${selectedCount}件のエントリーのフラグを変更しますか？`)) return;
    setSaving(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: Record<string, any> = { entryIds: selectedIds };
    if (entryFlag !== NO_CHANGE) body.entryFlag = entryFlag;
    if (entryFlagDetail !== NO_CHANGE) body.entryFlagDetail = entryFlagDetail;
    if (companyFlag !== NO_CHANGE) body.companyFlag = companyFlag;
    if (personFlag !== NO_CHANGE) body.personFlag = personFlag;

    try {
      const res = await fetch("/api/entries/bulk-flags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "更新に失敗しました");
      toast.success(data.message);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = entryFlag !== NO_CHANGE || entryFlagDetail !== NO_CHANGE || companyFlag !== NO_CHANGE || personFlag !== NO_CHANGE;
  const selectCls = "w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#2563EB]";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="border-b px-5 py-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-[#374151]">一括フラグ変更（{selectedCount}件）</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">エントリーフラグ</label>
            <select className={selectCls} value={entryFlag} onChange={(e) => handleEntryFlagChange(e.target.value)}>
              <option value={NO_CHANGE}>変更しない</option>
              {entryFlagOptions.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">フラグ詳細</label>
            <select className={selectCls} value={entryFlagDetail} onChange={(e) => setEntryFlagDetail(e.target.value)} disabled={entryFlag === NO_CHANGE}>
              <option value={NO_CHANGE}>変更しない</option>
              {detailOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">企業対応フラグ</label>
            <select className={selectCls} value={companyFlag} onChange={(e) => setCompanyFlag(e.target.value)} disabled={entryFlag === NO_CHANGE || companyOptions.length === 0}>
              <option value={NO_CHANGE}>変更しない</option>
              {companyOptions.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">本人対応フラグ</label>
            <select className={selectCls} value={personFlag} onChange={(e) => setPersonFlag(e.target.value)} disabled={entryFlag === NO_CHANGE || personOptions.length === 0}>
              <option value={NO_CHANGE}>変更しない</option>
              {personOptions.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>

        <div className="border-t px-5 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-sm font-medium hover:bg-gray-50">キャンセル</button>
          <button
            onClick={handleSubmit}
            disabled={!hasChanges || saving}
            className="flex-1 bg-[#2563EB] text-white rounded-md px-3 py-2 text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? "変更中..." : "一括変更"}
          </button>
        </div>
      </div>
    </div>
  );
}
