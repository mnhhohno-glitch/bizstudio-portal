"use client";

import { useEffect, useState, useCallback } from "react";
import ScoutNav from "@/components/scout/ScoutNav";
import ApplicantListModal, { type ApplicantQuery } from "@/components/scout/ApplicantListModal";

type Bucket = { key: string; deliveryCount: number; openCount: number; applyCount: number };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

export default function ByAppliedDatePage() {
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [groupBy, setGroupBy] = useState<"day" | "week" | "month">("day");
  const [stats, setStats] = useState<{ overall: Bucket[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [modalQuery, setModalQuery] = useState<ApplicantQuery | null>(null);
  const [modalTitle, setModalTitle] = useState("");

  // 応募数クリック→応募者一覧（applied バケットは stats と同一基準＝枠×先頭応募者の UTC暦日）。日単位のみ。
  const canClickApply = groupBy === "day";
  const openApplicants = useCallback(
    (appliedDate: string) => {
      setModalQuery({ appliedDate, from, to });
      setModalTitle(`${appliedDate} の応募者（応募日基準）`);
    },
    [from, to],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(
      `/api/scout/stats?axis=overall&from=${from}&to=${to}&groupBy=${groupBy}&dateMode=applied`,
    );
    if (res.ok) setStats(await res.json());
    setLoading(false);
  }, [from, to, groupBy]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <ScoutNav />
      <h1 className="text-[20px] font-bold text-[#374151]">応募日別集計</h1>
      <p className="mt-1 text-[12px] text-[#9CA3AF]">
        ※ 「設定数」「実施数」は本 Phase ではスコープ外（進行段階管理未実装）。応募数のみ表示
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-[#E5E7EB] bg-white p-3">
        <label className="text-[12px] text-[#6B7280]">期間:</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
        />
        <span>〜</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
        />
        <span className="ml-4 text-[12px] text-[#6B7280]">単位:</span>
        {(["day", "week", "month"] as const).map((g) => (
          <button
            key={g}
            onClick={() => setGroupBy(g)}
            className={`rounded px-3 py-1 text-[12px] ${
              groupBy === g ? "bg-[#2563EB] text-white" : "border border-[#E5E7EB] text-[#6B7280]"
            }`}
          >
            {g === "day" ? "日" : g === "week" ? "週" : "月"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-6 text-[#9CA3AF]">読み込み中...</p>
      ) : !stats ? (
        <p className="mt-6 text-[#9CA3AF]">データがありません</p>
      ) : (() => {
        const applyTotal = stats.overall.reduce((s, b) => s + b.applyCount, 0);
        const headCls = "sticky top-0 z-20 bg-[#F9FAFB] px-3 py-2";
        const totalCls = "sticky top-[35px] z-10 border-b-2 border-[#9CA3AF] bg-[#EFF6FF] px-3 py-2";
        return (
        <div className="mt-4 max-h-[70vh] overflow-auto rounded-lg border border-[#E5E7EB] bg-white">
          <table className="w-full text-[13px]">
            <thead className="text-[#6B7280]">
              <tr>
                <th className={`${headCls} text-left`}>応募日</th>
                <th className={`${headCls} text-right`}>応募数</th>
                <th className={`${headCls} text-right`}>設定数</th>
                <th className={`${headCls} text-right`}>設定率</th>
                <th className={`${headCls} text-right`}>実施数</th>
                <th className={`${headCls} text-right`}>実施率</th>
              </tr>
              {/* 合計行（ヘッダー直下に固定・最上部表示） */}
              <tr className="font-medium text-[#374151]">
                <td className={totalCls}>合計</td>
                <td className={`${totalCls} text-right`}>{applyTotal.toLocaleString()}</td>
                <td className={`${totalCls} text-right text-[#9CA3AF]`}>-</td>
                <td className={`${totalCls} text-right text-[#9CA3AF]`}>-</td>
                <td className={`${totalCls} text-right text-[#9CA3AF]`}>-</td>
                <td className={`${totalCls} text-right text-[#9CA3AF]`}>-</td>
              </tr>
            </thead>
            <tbody>
              {stats.overall.map((b) => (
                <tr key={b.key} className="border-t border-[#F3F4F6]">
                  <td className="px-3 py-1.5">{b.key}</td>
                  <td className="px-3 py-1.5 text-right">
                    {canClickApply && b.applyCount > 0 ? (
                      <button
                        onClick={() => openApplicants(b.key)}
                        className="text-[#2563EB] hover:underline"
                        title="応募者一覧を表示"
                      >
                        {b.applyCount.toLocaleString()}
                      </button>
                    ) : (
                      b.applyCount.toLocaleString()
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[#9CA3AF]">-</td>
                  <td className="px-3 py-1.5 text-right text-[#9CA3AF]">-</td>
                  <td className="px-3 py-1.5 text-right text-[#9CA3AF]">-</td>
                  <td className="px-3 py-1.5 text-right text-[#9CA3AF]">-</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        );
      })()}

      <ApplicantListModal
        open={modalQuery != null}
        onClose={() => setModalQuery(null)}
        title={modalTitle}
        query={modalQuery}
      />
    </div>
  );
}
