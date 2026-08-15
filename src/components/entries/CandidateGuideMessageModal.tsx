"use client";

// エントリー管理 → 求職者向け「現在の選考状況＋各求人ページURL」案内文の作成モーダル。
// 本文の組み立て・URL判定はすべてサーバー側（/api/entries/generate-message）が行う。
// クライアントは「対象の選択」「見送り済みを含めるか」「編集とコピー」だけを担う。
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useOverlayClose } from "@/hooks/useOverlayClose";
import type { Entry } from "./EntryBoard";

type Props = {
  selectedEntries: Entry[];
  onClose: () => void;
};

type Stats = {
  total: number;
  withUrl: number;
  withoutUrl: number;
  companiesWithoutUrl: string[];
  unclassified?: number;
};

export default function CandidateGuideMessageModal({ selectedEntries, onClose }: Props) {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const overlayClose = useOverlayClose(onClose);

  const candidateId = selectedEntries[0]?.candidateId ?? "";
  const candidateName = selectedEntries[0]?.candidate?.name ?? "";
  // 選択エントリーの並びが変わっても再取得しないよう、ID の集合を安定キー化する。
  const entryIdsKey = useMemo(
    () => selectedEntries.map((e) => e.id).sort().join(","),
    [selectedEntries],
  );

  const generate = useCallback(async () => {
    if (!candidateId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/entries/generate-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          entryIds: entryIdsKey ? entryIdsKey.split(",") : [],
          includeInactive,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setText("");
        setStats(null);
        setError(typeof data?.error === "string" ? data.error : "案内文の生成に失敗しました");
        return;
      }
      setText(data.message ?? "");
      setStats(data.stats ?? null);
    } catch {
      setText("");
      setStats(null);
      setError("案内文の生成に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [candidateId, entryIdsKey, includeInactive]);

  useEffect(() => {
    void generate();
  }, [generate]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("コピーしました");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("コピーに失敗しました");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" {...overlayClose}>
      <div
        className="bg-white rounded-lg p-5 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-gray-700 mb-1">案内文を作成</h3>
        <p className="text-[12px] text-gray-500 mb-3">
          {candidateName ? `${candidateName} 様` : ""} の現在の選考状況と、各求人ページのURLをまとめた案内文を作成します。
        </p>

        <label className="flex items-center gap-2 mb-3 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
            className="w-4 h-4"
          />
          見送り済みの選考も含める
        </label>

        {error && (
          <div className="mb-3 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-[12px] text-red-700">
            {error}
          </div>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={18}
          disabled={loading}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 mb-2 disabled:bg-gray-50"
          placeholder={loading ? "作成中..." : "（対象なし）"}
        />

        {stats && (
          <p className="text-[11px] text-gray-500 mb-1">
            対象 {stats.total}件 / URLあり {stats.withUrl}件 / URLなし {stats.withoutUrl}件
            {stats.unclassified ? ` / 選考状況を判定できず除外 ${stats.unclassified}件` : ""}
          </p>
        )}

        {stats && stats.companiesWithoutUrl.length > 0 && (
          <div className="mb-3 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
            以下の会社は求人ページのURLを出せませんでした（会社名のみ記載しています）:
            <br />
            {stats.companiesWithoutUrl.join(" / ")}
          </div>
        )}

        <div className="flex gap-2 justify-end mt-2">
          <button
            onClick={onClose}
            className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm hover:bg-gray-50"
          >
            閉じる
          </button>
          <button
            onClick={handleCopy}
            disabled={loading || !text.trim()}
            className="bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {copied ? "コピー済 ✓" : "コピー"}
          </button>
        </div>
      </div>
    </div>
  );
}
