"use client";

import { useEffect, useState } from "react";

/**
 * T-190 Step3-1: マイナビ「スカウト履歴一覧」（RPA が取り込んだ行）を求職者詳細に表示する。
 * 配信日がどの行から決まったのかを CA が確認できるようにするためのパネル。
 *
 * 履歴が 0 件の求職者では何も描画しない（既存画面の見た目を変えない）。
 */

type History = {
  id: string;
  scoutDate: string; // "YYYY-MM-DD"（JST）
  subject: string | null;
  statusText: string;
  isApplied: boolean;
  recruiterName: string | null;
};

type Props = { candidateId: string };

export default function MynaviScoutHistoryPanel({ candidateId }: Props) {
  const [histories, setHistories] = useState<History[]>([]);
  const [selectedScoutDate, setSelectedScoutDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/scout/candidates/mynavi-history?candidateId=${encodeURIComponent(candidateId)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setHistories(Array.isArray(data.histories) ? data.histories : []);
        setSelectedScoutDate(data.selectedScoutDate ?? null);
      } catch {
        // silent（履歴が読めなくても既存画面を壊さない）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candidateId]);

  if (histories.length === 0) return null;

  // 採用された行 = 応募済 かつ スカウト日が現在の配信日と一致する行
  const adoptedId = histories.find((h) => h.isApplied && h.scoutDate === selectedScoutDate)?.id ?? null;

  return (
    <div className="mt-4 rounded-lg border border-[#E5E7EB] bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-[#374151]">
          マイナビ スカウト履歴（{histories.length}件）
        </h3>
        <span className="text-[11px] text-[#6B7280]">
          配信日は「応募済」の行のスカウト日から決まります
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-[#E5E7EB] text-left text-[11px] text-[#6B7280]">
              <th className="whitespace-nowrap py-1.5 pr-3">スカウト日</th>
              <th className="py-1.5 pr-3">件名</th>
              <th className="whitespace-nowrap py-1.5 pr-3">状況</th>
              <th className="whitespace-nowrap py-1.5">担当者</th>
            </tr>
          </thead>
          <tbody>
            {histories.map((h) => (
              <tr
                key={h.id}
                className={`border-b border-[#F3F4F6] ${h.isApplied ? "bg-[#ECFDF5]" : ""}`}
              >
                <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-[#374151]">
                  {h.scoutDate}
                  {h.id === adoptedId && (
                    <span className="ml-2 rounded bg-[#16A34A] px-1.5 py-0.5 text-[10px] text-white">
                      採用
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-[#374151]">{h.subject ?? "—"}</td>
                <td
                  className={`whitespace-nowrap py-1.5 pr-3 ${
                    h.isApplied ? "font-semibold text-[#16A34A]" : "text-[#6B7280]"
                  }`}
                >
                  {h.statusText || "—"}
                </td>
                <td className="whitespace-nowrap py-1.5 text-[#374151]">{h.recruiterName ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
