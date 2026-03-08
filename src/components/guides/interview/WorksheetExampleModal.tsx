"use client";

import { useState } from "react";
import type { WorksheetExampleSet } from "@/lib/guides/interview/worksheet-examples";

interface WorksheetExampleModalProps {
  isOpen: boolean;
  onClose: () => void;
  exampleSet: WorksheetExampleSet;
  onSelect: (text: string) => void;
}

export default function WorksheetExampleModal({
  isOpen,
  onClose,
  exampleSet,
  onSelect,
}: WorksheetExampleModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (!isOpen) return null;

  const toggle = (text: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(text)) {
        next.delete(text);
      } else {
        next.add(text);
      }
      return next;
    });
  };

  const handleSubmit = () => {
    if (selected.size === 0) return;
    const combined = Array.from(selected).join("\n");
    onSelect(combined);
    setSelected(new Set());
  };

  const handleClose = () => {
    setSelected(new Set());
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <p className="text-lg font-bold text-[#003366]">
            「{exampleSet.fieldLabel}」の記入例
          </p>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* 説明文 */}
        <div className="px-6 py-3 bg-[#F4F7F9] text-sm text-gray-600 shrink-0">
          {exampleSet.description}
        </div>

        {/* 本体 */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {exampleSet.categories.map((cat, ci) => (
            <div key={cat.category}>
              <p
                className={`text-sm font-bold text-[#003366] bg-[#F4F7F9] rounded-lg px-3 py-2 mb-3 ${ci === 0 ? "" : "mt-4"}`}
              >
                {cat.category}
              </p>
              <div className="space-y-1">
                {cat.examples.map((ex) => {
                  const isSelected = selected.has(ex.text);
                  return (
                    <button
                      key={ex.text}
                      type="button"
                      onClick={() => toggle(ex.text)}
                      className="flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-[#F4F7F9] transition-colors w-full text-left"
                    >
                      <span
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                          isSelected
                            ? "bg-[#003366] border-[#003366] text-white"
                            : "border-gray-300"
                        }`}
                      >
                        {isSelected && (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <span className="text-sm text-gray-700">{ex.text}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* フッター */}
        <div className="px-6 py-4 border-t border-gray-200 shrink-0">
          <button
            onClick={handleSubmit}
            disabled={selected.size === 0}
            className="bg-[#003366] text-white rounded-lg px-6 py-2.5 font-medium w-full disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#002244] transition-colors"
          >
            {selected.size > 0
              ? `選択した例文を取り込む（${selected.size}件）`
              : "選択した例文を取り込む"}
          </button>
        </div>
      </div>
    </div>
  );
}
