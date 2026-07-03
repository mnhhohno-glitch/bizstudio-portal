"use client";

import { useState } from "react";
import { toast } from "sonner";

// T-130 Phase2 step1: 求職者サイトの「閲覧専用プレビュー」を新タブで開くボタン。
// 押下 → 発行API（POST /api/candidates/{id}/site-preview-url）→ 返却URLを新タブで開く。
// トークン未発行（409）時は「先にURL発行してください」をトースト表示。
// 誕生日未登録（トークン発行不能）の候補者では disabled（既存 URL 発行ガードと同条件）。

interface Props {
  candidateId: string;
  hasBirthday: boolean;
}

export default function SitePreviewButton({ candidateId, hasBirthday }: Props) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    // ポップアップブロック回避: fetch 前に空タブを開き、URL 取得後に遷移させる。
    const tab = window.open("", "_blank");
    try {
      const res = await fetch(`/api/candidates/${candidateId}/site-preview-url`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        tab?.close();
        toast.error("先にURL発行してください");
        return;
      }
      if (!res.ok || !data.previewUrl) {
        tab?.close();
        toast.error(data.error || "プレビューURLの発行に失敗しました");
        return;
      }

      if (tab) {
        tab.location.href = data.previewUrl;
      } else {
        // 空タブが開けなかった場合は同タブ遷移にフォールバック。
        window.open(data.previewUrl, "_blank");
      }
    } catch {
      tab?.close();
      toast.error("プレビューURLの発行に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={!hasBirthday || loading}
      title={hasBirthday ? "求職者サイトを閲覧専用で開く" : "生年月日が未登録のため利用できません"}
      className="border border-blue-200 bg-blue-50 text-blue-700 rounded-md px-3 py-1 text-[12px] hover:bg-blue-100 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {loading ? "準備中..." : "サイトをプレビュー"}
    </button>
  );
}
