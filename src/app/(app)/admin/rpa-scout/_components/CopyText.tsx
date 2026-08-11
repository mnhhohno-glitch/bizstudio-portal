"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useOverlayClose } from "@/hooks/useOverlayClose";

// 件名・本文のクリップボードコピー。
// navigator.clipboard は権限・非セキュアコンテキストで失敗し得るため、
// 失敗時は全文を選択可能なテキストエリアで出す（改行を保った手動コピーの逃げ道）。
export function useCopyText() {
  const [fallback, setFallback] = useState<{ title: string; text: string } | null>(null);

  const copy = useCallback((text: string, label: string) => {
    if (!text) {
      toast.error(`${label}が空です`);
      return;
    }
    const show = () => setFallback({ title: label, text });
    if (!navigator.clipboard?.writeText) {
      show();
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label}をコピーしました`),
      () => show()
    );
  }, []);

  return { copy, fallback, closeFallback: () => setFallback(null) };
}

export function CopyFallbackModal({
  title,
  text,
  onClose,
}: {
  title: string;
  text: string;
  onClose: () => void;
}) {
  const overlayClose = useOverlayClose(onClose);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      {...overlayClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-[15px] font-bold text-[#374151]">{title}（手動コピー）</h2>
          <button onClick={onClose} className="text-xl text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>
        <div className="px-5 py-4">
          <div className="mb-2 text-[12px] text-[#B45309]">
            自動コピーに失敗しました。下の内容を全選択してコピーしてください。
          </div>
          <textarea
            readOnly
            value={text}
            onFocus={(e) => e.currentTarget.select()}
            autoFocus
            className="h-[50vh] w-full resize-y rounded-[6px] border border-[#D1D5DB] p-2 font-mono text-[12px] leading-relaxed"
          />
        </div>
        <div className="flex justify-end border-t px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-[6px] border border-[#D1D5DB] px-4 py-1.5 text-[13px] text-[#374151] hover:bg-[#F9FAFB]"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
