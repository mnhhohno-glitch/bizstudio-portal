"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useOverlayClose } from "@/hooks/useOverlayClose";
import { nowJstDateTimeLocal } from "@/lib/rpa-scout/jst";
import {
  currentSubjectTemplateId,
  type RpaMachine,
  type RpaPattern,
  type RpaTemplate,
} from "./types";
import LastUsedNote from "./LastUsedNote";
import PatternSelect from "./PatternSelect";
import SubjectTemplateSelect from "./SubjectTemplateSelect";

// 状況ボードの「更新」モーダル。保存で RpaScoutLog に1レコードINSERT
export default function UpdateLogModal({
  machine,
  patterns,
  templates,
  onClose,
  onSaved,
}: {
  machine: RpaMachine;
  patterns: RpaPattern[];
  templates: RpaTemplate[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const overlayClose = useOverlayClose(onClose);
  const [patternId, setPatternId] = useState("");
  const [subjectTemplateId, setSubjectTemplateId] = useState("");
  const [searchCount, setSearchCount] = useState<string>("");
  const [recordedAt, setRecordedAt] = useState(nowJstDateTimeLocal());
  const [saving, setSaving] = useState(false);

  const selectedPattern = patterns.find((p) => p.id === patternId);

  const save = async () => {
    if (!patternId) {
      toast.error("パターンを選択してください");
      return;
    }
    if (!subjectTemplateId) {
      toast.error("件名テンプレートを選択してください");
      return;
    }
    if (!recordedAt) {
      toast.error("記録日時を入力してください");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/rpa-scout/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        machineNo: machine.machineNo,
        patternId,
        subjectTemplateId,
        searchCount: searchCount === "" ? null : Number(searchCount),
        recordedAt,
      }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("記録しました");
      onSaved();
    } else {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "保存に失敗しました");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      {...overlayClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-[15px] font-bold text-[#374151]">
            {machine.machineNo}号機の設定を更新
          </h2>
          <button onClick={onClose} className="text-xl text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        <div className="space-y-4 p-5 text-[14px]">
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-[#6B7280]">
              パターン
            </label>
            <PatternSelect
              patterns={patterns}
              value={patternId}
              onChange={setPatternId}
              machineNo={machine.machineNo}
            />
            <LastUsedNote pattern={selectedPattern} />
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-semibold text-[#6B7280]">
              件名テンプレート
            </label>
            <SubjectTemplateSelect
              templates={templates}
              value={subjectTemplateId}
              onChange={setSubjectTemplateId}
              sendStatus={selectedPattern?.sendStatus ?? null}
              currentTemplateId={currentSubjectTemplateId(machine, templates)}
            />
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-semibold text-[#6B7280]">
              検索件数（空欄=停止記録）
            </label>
            <input
              type="number"
              min={0}
              value={searchCount}
              onChange={(e) => setSearchCount(e.target.value)}
              placeholder="例: 850"
              className="w-full rounded-[6px] border border-[#D1D5DB] px-2 py-1.5"
            />
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-semibold text-[#6B7280]">
              記録日時
            </label>
            <input
              type="datetime-local"
              value={recordedAt}
              onChange={(e) => setRecordedAt(e.target.value)}
              className="w-full rounded-[6px] border border-[#D1D5DB] px-2 py-1.5"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-[6px] border border-[#D1D5DB] px-4 py-1.5 text-[13px] text-[#374151] hover:bg-[#F9FAFB]"
          >
            キャンセル
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-[6px] bg-[#2563EB] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
