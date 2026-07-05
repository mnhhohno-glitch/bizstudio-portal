"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useOverlayClose } from "@/hooks/useOverlayClose";

// T-128 公開準備②: 求人サイトURL発行ボタン＋モーダル（自己完結）。
// 面談後に CA が押すと kyuujinPDF で発行（冪等）し、siteUrl をモーダル表示＋ワンクリックコピー。
// 誕生日未登録の候補者はガード文言を表示して発行しない。

// 案内文テンプレ（後から調整できる定数）。{URL} を発行URLに置換して使う。
const ANNOUNCEMENT_TEMPLATE =
  "非公開求人サイトのご案内です。\nこちらのURLから、生年月日（8桁）でログインしてご覧いただけます。\n{URL}";

function buildAnnouncement(url: string): string {
  return ANNOUNCEMENT_TEMPLATE.replace("{URL}", url);
}

interface Props {
  candidateId: string;
  hasBirthday: boolean;
}

export default function IssueSiteTokenButton({ candidateId, hasBirthday }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [issued, setIssued] = useState<boolean | null>(null);
  const [noBirthday, setNoBirthday] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayClose = useOverlayClose(() => setOpen(false));

  const handleClick = async () => {
    setOpen(true);
    setLoading(true);
    setSiteUrl(null);
    setWarning(null);
    setIssued(null);
    setNoBirthday(false);
    setError(null);

    try {
      const res = await fetch(`/api/candidates/${candidateId}/issue-site-token`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "URL発行に失敗しました");
      } else if (data.ok === false && data.reason === "no-birthday") {
        setNoBirthday(true);
      } else {
        setSiteUrl(data.siteUrl ?? null);
        setWarning(data.warning ?? null);
        setIssued(data.issued ?? null);
      }
    } catch {
      setError("URL発行に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`コピーしました: ${label}`);
    } catch {
      toast.error("コピーに失敗しました");
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className="border border-blue-200 bg-blue-50 text-blue-700 rounded-md px-3 py-1 text-[12px] hover:bg-blue-100 transition-colors font-medium"
      >
        求人サイトURLを発行
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          {...overlayClose}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-[520px] max-w-[92vw] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[15px] font-bold text-gray-800">求人サイトURL発行</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>

            {loading && (
              <div className="py-8 text-center text-[13px] text-gray-500">発行中...</div>
            )}

            {!loading && noBirthday && (
              <div className="py-4 text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-md px-3">
                生年月日が未登録のため発行できません（候補者情報に登録してください）。
              </div>
            )}

            {!loading && error && (
              <div className="py-4 text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-md px-3">
                {error}
              </div>
            )}

            {!loading && siteUrl && (
              <div className="space-y-3">
                {issued !== null && (
                  <div className="text-[12px] text-gray-500">
                    {issued ? "新規発行しました。" : "既に発行済みのURLです（同じURLが表示されます）。"}
                  </div>
                )}

                {warning && (
                  <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    ⚠️ {warning}
                  </div>
                )}

                {/* URL + コピー */}
                <div>
                  <label className="block text-[12px] text-gray-400 mb-1">発行URL</label>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={siteUrl}
                      className="flex-1 border border-gray-300 rounded-md px-2 py-1.5 text-[13px] text-gray-700 bg-gray-50"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button
                      onClick={() => copy(siteUrl, "URL")}
                      className="border border-blue-200 bg-blue-50 text-blue-700 rounded-md px-3 py-1.5 text-[12px] hover:bg-blue-100 whitespace-nowrap"
                    >
                      URLをコピー
                    </button>
                  </div>
                </div>

                {/* 案内文テンプレ + コピー */}
                <div>
                  <label className="block text-[12px] text-gray-400 mb-1">案内文（テンプレ）</label>
                  <textarea
                    readOnly
                    value={buildAnnouncement(siteUrl)}
                    rows={4}
                    className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-[13px] text-gray-700 bg-gray-50 resize-none"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <div className="mt-2 text-right">
                    <button
                      onClick={() => copy(buildAnnouncement(siteUrl), "案内文")}
                      className="border border-blue-200 bg-blue-50 text-blue-700 rounded-md px-3 py-1.5 text-[12px] hover:bg-blue-100"
                    >
                      案内文をコピー
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
