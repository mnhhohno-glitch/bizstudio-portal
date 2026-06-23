"use client";

import { useEffect, useState } from "react";
import { formatRecruiterName } from "@/lib/recruiterDisplay";
import { SUPPORT_STATUS_LABEL } from "@/lib/support-status-constants";

export type ApplicantQuery = {
  slotId?: string;
  date?: string;
  media?: string;
  appliedDate?: string;
  from?: string;
  to?: string;
  machineLabel?: string;
};

type Machine = { recruiterName: string; machineNumber: number | null; isMachine: boolean };

type Applicant = {
  id: string;
  candidateNumber: string;
  name: string;
  age: number | null;
  isForeigner: boolean;
  category: string;
  appliedDate: string | null;
  recruiterName: string | null;
  masType: string | null;
  machine: Machine | null;
  deliveryCategoryLarge: string | null;
  deliveryCategoryMedium: string | null;
  deliveryCategorySmall: string | null;
  supportStatus: string;
  supportSubStatus: string | null;
};

/** 配信担当を「実名(RPA○号機)」表記で返す。号機は recruiterDisplay の正規対応表を通す。 */
function recruiterLabel(c: Applicant): string {
  const m = c.machine;
  if (m?.isMachine && m.machineNumber != null) {
    // "RPA○号機" → 実名(RPA○号機)（T-104 の MACHINE_NUMBER_TO_REAL_NAME）
    return formatRecruiterName(`RPA${m.machineNumber}号機`);
  }
  if (m?.recruiterName) return m.recruiterName; // 社員枠など号機なし
  return c.recruiterName ? formatRecruiterName(c.recruiterName) : "—";
}

/** 配信種別を「中分類 / 小分類」（無ければ大分類）で返す。配信枠管理の表記に合わせる。 */
function deliveryTypeLabel(c: Applicant): string {
  const mid = c.deliveryCategoryMedium;
  const small = c.deliveryCategorySmall;
  if (mid) return small ? `${mid} / ${small}` : mid;
  return c.deliveryCategoryLarge ?? "—";
}

/** 支援状況を portal 求職者一覧と同じ日本語表記（＋サブステータス併記）で返す。 */
function supportLabel(c: Applicant): string {
  const main = SUPPORT_STATUS_LABEL[c.supportStatus] ?? c.supportStatus;
  return c.supportSubStatus ? `${main} / ${c.supportSubStatus}` : main;
}

/**
 * スカウト集計の数値クリックで応募者一覧を表示する共通モーダル。
 * query が変わるたびに /api/scout/candidates を取得する。配信日別／配信枠管理で共用。
 */
export default function ApplicantListModal({
  open,
  onClose,
  title,
  query,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  query: ApplicantQuery | null;
}) {
  const [rows, setRows] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !query) return;
    let aborted = false;
    setLoading(true);
    setRows([]);
    const params = new URLSearchParams();
    if (query.slotId) params.set("slotId", query.slotId);
    if (query.date) params.set("date", query.date);
    if (query.media) params.set("media", query.media);
    if (query.appliedDate) params.set("appliedDate", query.appliedDate);
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    if (query.machineLabel) params.set("machineLabel", query.machineLabel);
    fetch(`/api/scout/candidates?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { candidates: [] }))
      .then((d) => {
        if (!aborted) setRows(d.candidates || []);
      })
      .catch(() => {
        if (!aborted) setRows([]);
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [open, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-[min(1100px,95vw)] flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
          <h3 className="text-[14px] font-semibold text-[#374151]">{title}</h3>
          <button onClick={onClose} className="text-[18px] leading-none text-[#9CA3AF] hover:text-[#374151]">
            ✕
          </button>
        </div>
        <div className="overflow-auto p-4">
          {loading ? (
            <p className="py-8 text-center text-[13px] text-[#9CA3AF]">読み込み中...</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-[#9CA3AF]">応募者がいません</p>
          ) : (
            <>
              <p className="mb-2 text-[12px] text-[#6B7280]">{rows.length}名</p>
              <table className="w-full min-w-max text-[12px]">
                <thead className="bg-[#F9FAFB] text-[#6B7280]">
                  <tr className="whitespace-nowrap">
                    <th className="px-2 py-1.5 text-left font-medium">求職者番号</th>
                    <th className="px-2 py-1.5 text-left font-medium">氏名</th>
                    <th className="px-2 py-1.5 text-right font-medium">年齢</th>
                    <th className="px-2 py-1.5 text-center font-medium">区分</th>
                    <th className="px-2 py-1.5 text-left font-medium">応募日</th>
                    <th className="px-2 py-1.5 text-left font-medium">配信担当</th>
                    <th className="px-2 py-1.5 text-left font-medium">配信種別</th>
                    <th className="px-2 py-1.5 text-left font-medium">開放日</th>
                    <th className="px-2 py-1.5 text-left font-medium">支援状況</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className="whitespace-nowrap border-t border-[#F3F4F6]">
                      <td className="px-2 py-1.5 font-mono text-[#6B7280]">{c.candidateNumber}</td>
                      <td className="px-2 py-1.5">
                        <a
                          href={`/candidates/${c.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#2563EB] hover:underline"
                        >
                          {c.name}
                        </a>
                        {c.isForeigner && (
                          <span className="ml-1 rounded bg-[#FEF3C7] px-1 text-[10px] text-[#92400E]">外国籍</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">{c.age != null ? `${c.age}歳` : "—"}</td>
                      <td className="px-2 py-1.5 text-center">
                        <span
                          className={
                            c.category === "有効"
                              ? "text-[#16A34A]"
                              : c.category === "無効"
                                ? "text-[#DC2626]"
                                : "text-[#9CA3AF]"
                          }
                        >
                          {c.category}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">{c.appliedDate ?? "—"}</td>
                      <td className="px-2 py-1.5">{recruiterLabel(c)}</td>
                      <td className="px-2 py-1.5">{deliveryTypeLabel(c)}</td>
                      <td className="px-2 py-1.5">{c.masType ?? "—"}</td>
                      <td className="px-2 py-1.5">{supportLabel(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
