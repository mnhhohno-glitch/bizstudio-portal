"use client";

// T-189 追加: 「配信条件（パターン）が求人サイトに未登録」のときに出す共通ダイアログ。
//
// 出る場面は2つ（文言・遷移先は同一にする）:
//   ① 自動配信トグルを OFF→ON にしようとしたが条件が0件（画面判定 or サーバーの 400 condition_not_found）
//   ② 「今すぐ探す」で job-platform が 404 condition_not_found を返した
//
// 「求人サイトで登録する」は portal SSO（issue-app-token）で /jobs を新規タブで開く。
// 求職者選択モード自体は job-platform 側のページ内 state のため URL では復元できない
// （openJobPlatformSearch のコメント参照）。CA が画面上でモードを切り替えて求職者を選ぶ。
import { useState } from "react";
import { useOverlayClose } from "@/hooks/useOverlayClose";
import { openJobPlatformSearch } from "@/lib/openJobPlatformDetail";

export default function AutoRecommendConditionDialog({
  open,
  candidateName,
  candidateNumber,
  onClose,
}: {
  open: boolean;
  candidateName?: string;
  candidateNumber?: string;
  onClose: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const overlayClose = useOverlayClose(onClose);

  if (!open) return null;

  const handleOpenSite = async () => {
    if (opening) return;
    setOpening(true);
    try {
      await openJobPlatformSearch();
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" {...overlayClose}>
      <div
        className="bg-white rounded-[8px] w-full max-w-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
          <h2 className="text-[15px] font-bold text-[#374151]">配信条件が登録されていません</h2>
          <button
            onClick={onClose}
            className="text-[#6B7280] hover:text-[#374151] text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-5 text-[13px] leading-6 text-[#374151]">
          <p>
            この求職者の配信条件（パターン）が求人サイトに登録されていないため、自動配信を ON
            にできません。求人サイトで検索条件を組み、「この条件をパターン登録」を押してください。
          </p>
          {(candidateName || candidateNumber) && (
            <p className="mt-3 text-[12px] text-[#6B7280]">
              対象: {candidateName ?? ""}
              {candidateNumber ? `（${candidateNumber}）` : ""}
            </p>
          )}
          <p className="mt-3 text-[12px] text-[#6B7280]">
            求人サイトでは「求職者選択」モードに切り替え、この求職者を選んでから条件を保存してください。
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-6 py-4">
          <button
            onClick={onClose}
            className="h-9 rounded-md border border-gray-300 bg-white px-4 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
          >
            閉じる
          </button>
          <button
            onClick={handleOpenSite}
            disabled={opening}
            className="h-9 rounded-md bg-[#2563EB] px-4 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {opening ? "開いています…" : "求人サイトで登録する"}
          </button>
        </div>
      </div>
    </div>
  );
}
