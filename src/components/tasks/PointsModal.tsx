"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  onClose: () => void;
};

export default function PointsModal({ value, onChange, readOnly, onClose }: Props) {
  const [tab, setTab] = useState<"preview" | "edit">(readOnly ? "preview" : "preview");
  const [draft, setDraft] = useState(value);
  const [aiOrganizing, setAiOrganizing] = useState(false);

  const handleSave = () => {
    onChange?.(draft);
    onClose();
  };

  const handleAiOrganize = async () => {
    const text = draft.trim();
    if (!text) return;
    setAiOrganizing(true);
    try {
      const res = await fetch("/api/tasks/ai-organize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) { alert("整理に失敗しました"); return; }
      const data = await res.json();
      if (data.organized) setDraft(data.organized);
    } catch { alert("整理に失敗しました"); }
    finally { setAiOrganizing(false); }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-[8px] shadow-xl flex flex-col"
        style={{ width: "80vw", height: "70vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-3 shrink-0">
          <h2 className="text-[15px] font-bold text-[#374151]">求人のポイント・条件</h2>
          <div className="flex items-center gap-3">
            {!readOnly && (
              <div className="flex rounded-[6px] border border-[#E5E7EB] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setTab("preview")}
                  className={`px-3 py-1 text-[12px] font-medium transition-colors ${
                    tab === "preview" ? "bg-[#2563EB] text-white" : "bg-white text-[#374151] hover:bg-[#F3F4F6]"
                  }`}
                >
                  プレビュー
                </button>
                <button
                  type="button"
                  onClick={() => setTab("edit")}
                  className={`px-3 py-1 text-[12px] font-medium transition-colors ${
                    tab === "edit" ? "bg-[#2563EB] text-white" : "bg-white text-[#374151] hover:bg-[#F3F4F6]"
                  }`}
                >
                  編集
                </button>
              </div>
            )}
            <button
              onClick={onClose}
              className="text-[#6B7280] hover:text-[#374151] text-xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        {/* body */}
        <div className="flex-1 overflow-auto p-6">
          {tab === "preview" ? (
            <div className="prose prose-sm max-w-none text-[14px] text-[#374151]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {readOnly ? value : draft}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="h-full flex flex-col">
              {/* AI整理ボタン */}
              <div className="mb-2 flex gap-2">
                <button
                  type="button"
                  disabled={aiOrganizing || !draft.trim()}
                  onClick={handleAiOrganize}
                  className="inline-flex items-center gap-1 rounded-[6px] border border-[#D1D5DB] bg-white px-3 py-1.5 text-[12px] font-medium text-[#6B7280] transition-colors hover:bg-[#F3F4F6] hover:text-[#2563EB] disabled:opacity-40"
                >
                  {aiOrganizing ? "整理中..." : "✨ AI整理"}
                </button>
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1 w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] resize-none"
              />
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[#E5E7EB] px-6 py-3 shrink-0">
          {readOnly ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-[6px] border border-[#D1D5DB] bg-white px-4 py-2 text-[13px] font-medium text-[#374151] transition-colors hover:bg-[#F3F4F6]"
            >
              閉じる
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-[6px] border border-[#D1D5DB] bg-white px-4 py-2 text-[13px] font-medium text-[#374151] transition-colors hover:bg-[#F3F4F6]"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="rounded-[6px] bg-[#2563EB] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#1D4ED8]"
              >
                保存して閉じる
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
