"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { Entry } from "./EntryBoard";

type Props = {
  selectedEntries: Entry[];
  onClose: () => void;
  onDone: () => void;
};

type EndReason = "書類見送り" | "面接見送り" | "本人辞退";

const REASON_OPTIONS: { value: EndReason; label: string }[] = [
  { value: "書類見送り", label: "書類見送り" },
  { value: "面接見送り", label: "面接見送り" },
  { value: "本人辞退", label: "本人辞退" },
];

function buildFlagPatch(reason: EndReason): Record<string, unknown> {
  switch (reason) {
    case "書類見送り":
      return {
        entryFlagDetail: "書類見送り",
        companyFlag: null,
        personFlag: "見送り通知未送信",
        isActive: false,
      };
    case "面接見送り":
      return {
        entryFlagDetail: "面接見送り",
        companyFlag: null,
        personFlag: "見送り通知未送信",
        isActive: false,
      };
    case "本人辞退":
      return {
        entryFlagDetail: "本人辞退",
        companyFlag: "辞退報告前",
        personFlag: "辞退受付済",
        isActive: false,
      };
  }
}

export default function BulkEndFlagModal({ selectedEntries, onClose, onDone }: Props) {
  const [reason, setReason] = useState<EndReason>("書類見送り");
  const [updating, setUpdating] = useState(false);

  const handleConfirm = async () => {
    setUpdating(true);
    const patch = buildFlagPatch(reason);
    let success = 0;
    let failed = 0;
    for (const entry of selectedEntries) {
      try {
        const res = await fetch(`/api/entries/${entry.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (res.ok) success += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    setUpdating(false);
    if (success > 0) {
      toast.success(`${success}件の選考を終了しました${failed > 0 ? `（${failed}件失敗）` : ""}`);
      onDone();
    } else {
      toast.error("選考終了フラグの更新に失敗しました");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">選考終了フラグの一括変更</h2>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">
          <p className="text-sm text-gray-700 mb-3">
            選択した<span className="font-semibold text-[#2563EB]">{selectedEntries.length}件</span>のエントリーの選考を終了しますか？
          </p>

          <div className="mb-4">
            <label className="block text-xs text-gray-500 mb-1">終了理由</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as EndReason)}
              disabled={updating}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
            >
              {REASON_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">対象エントリー</label>
            <div className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-64 overflow-y-auto">
              {selectedEntries.map((entry) => (
                <div key={entry.id} className="px-3 py-2 text-sm flex items-start gap-2">
                  <span className="text-gray-500 shrink-0">{entry.candidate.name}</span>
                  <span className="text-gray-300">／</span>
                  <span className="text-gray-700 truncate">{entry.companyName}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2 bg-gray-50">
          <button
            onClick={onClose}
            disabled={updating}
            className="px-4 py-2 text-sm font-medium border border-gray-300 bg-white text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={handleConfirm}
            disabled={updating}
            className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            {updating ? "更新中..." : "終了する"}
          </button>
        </div>
      </div>
    </div>
  );
}
