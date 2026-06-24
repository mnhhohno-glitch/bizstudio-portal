"use client";

import { useEffect, useState, useCallback } from "react";
import ScoutNav from "@/components/scout/ScoutNav";
import { formatRecruiterName } from "@/lib/recruiterDisplay";
import ApplicantListModal, { type ApplicantQuery } from "@/components/scout/ApplicantListModal";

type Bucket = { key: string; deliveryCount: number; openCount: number; applyCount: number };

type Stats = {
  axis: string;
  groupBy: string;
  overall: Bucket[];
  subBuckets: Record<string, Bucket[]>;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

export default function ByDeliveryDatePage() {
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [groupBy, setGroupBy] = useState<"day" | "week" | "month">("day");
  const [axis, setAxis] = useState<"overall" | "media" | "machine" | "category">("overall");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  // 応募数クリック→応募者一覧モーダル
  const [modalQuery, setModalQuery] = useState<ApplicantQuery | null>(null);
  const [modalTitle, setModalTitle] = useState("");

  // 日単位のときのみ応募数をクリック可能にする（key=配信日 YYYY-MM-DD）。media 軸では媒体も絞る。
  const openApplicants = useCallback(
    (bucketKey: string, mediaKey?: string) => {
      setModalQuery({ date: bucketKey, ...(mediaKey ? { media: mediaKey } : {}) });
      setModalTitle(`${bucketKey}${mediaKey ? ` / ${mediaKey}` : ""} の応募者`);
    },
    [],
  );
  const canClickApply = groupBy === "day";

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(
      `/api/scout/stats?axis=${axis}&from=${from}&to=${to}&groupBy=${groupBy}&dateMode=sent`,
    );
    if (res.ok) setStats(await res.json());
    setLoading(false);
  }, [from, to, groupBy, axis]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <ScoutNav />
      <h1 className="text-[20px] font-bold text-[#374151]">配信日別集計</h1>

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

        <span className="ml-4 text-[12px] text-[#6B7280]">軸:</span>
        {(["overall", "media", "machine", "category"] as const).map((a) => (
          <button
            key={a}
            onClick={() => setAxis(a)}
            className={`rounded px-3 py-1 text-[12px] ${
              axis === a ? "bg-[#2563EB] text-white" : "border border-[#E5E7EB] text-[#6B7280]"
            }`}
          >
            {a === "overall" ? "全体" : a === "media" ? "媒体" : a === "machine" ? "号機" : "配信種別"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-6 text-[#9CA3AF]">読み込み中...</p>
      ) : !stats ? (
        <p className="mt-6 text-[#9CA3AF]">データがありません</p>
      ) : axis === "overall" ? (
        <StatsTable buckets={stats.overall} onApply={canClickApply ? (k) => openApplicants(k) : undefined} />
      ) : (
        <>
          {Object.entries(stats.subBuckets).length === 0 ? (
            <p className="mt-6 text-[#9CA3AF]">データがありません</p>
          ) : (
            Object.entries(stats.subBuckets).map(([key, buckets]) => (
              <div key={key} className="mt-6">
                <h3 className="text-[14px] font-semibold text-[#374151] mb-2">{formatRecruiterName(key)}</h3>
                {/* 媒体軸のみ応募数クリックで media 絞り込み一覧（号機/種別軸は API 非対応のため非クリック） */}
                <StatsTable
                  buckets={buckets}
                  onApply={axis === "media" && canClickApply ? (k) => openApplicants(k, key) : undefined}
                />
              </div>
            ))
          )}
        </>
      )}

      <ApplicantListModal
        open={modalQuery != null}
        onClose={() => setModalQuery(null)}
        title={modalTitle}
        query={modalQuery}
      />
    </div>
  );
}

function StatsTable({ buckets, onApply }: { buckets: Bucket[]; onApply?: (bucketKey: string) => void }) {
  const totals = buckets.reduce(
    (acc, b) => ({
      d: acc.d + b.deliveryCount,
      o: acc.o + b.openCount,
      a: acc.a + b.applyCount,
    }),
    { d: 0, o: 0, a: 0 },
  );
  const oRateTotal = totals.d > 0 ? ((totals.o / totals.d) * 100).toFixed(1) : "0.0";
  const aRateTotal = totals.d > 0 ? ((totals.a / totals.d) * 100).toFixed(2) : "0.00";
  // sticky: ヘッダー=上端固定 / 合計=ヘッダー直下固定（ヘッダー高さ分オフセット・1px 重ねて body の透けを防止）
  const headCls = "sticky top-0 z-20 bg-[#F9FAFB] px-3 py-2";
  const totalCls = "sticky top-[35px] z-10 border-b-2 border-[#9CA3AF] bg-[#EFF6FF] px-3 py-2";
  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-[#E5E7EB] bg-white">
      <table className="w-full text-[13px]">
        <thead className="text-[#6B7280]">
          {/* 列見出し（上端固定） */}
          <tr>
            <th className={`${headCls} text-left`}>期間</th>
            <th className={`${headCls} text-right`}>配信</th>
            <th className={`${headCls} text-right`}>開封</th>
            <th className={`${headCls} text-right`}>開封率</th>
            <th className={`${headCls} text-right`}>応募</th>
            <th className={`${headCls} text-right`}>応募率</th>
          </tr>
          {/* 合計行（ヘッダー直下に固定・最上部表示） */}
          <tr className="font-medium text-[#374151]">
            <td className={totalCls}>合計</td>
            <td className={`${totalCls} text-right`}>{totals.d.toLocaleString()}</td>
            <td className={`${totalCls} text-right`}>{totals.o.toLocaleString()}</td>
            <td className={`${totalCls} text-right`}>{oRateTotal}%</td>
            <td className={`${totalCls} text-right`}>{totals.a.toLocaleString()}</td>
            <td className={`${totalCls} text-right`}>{aRateTotal}%</td>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => {
            const oRate = b.deliveryCount > 0 ? (b.openCount / b.deliveryCount) * 100 : 0;
            const aRate = b.deliveryCount > 0 ? (b.applyCount / b.deliveryCount) * 100 : 0;
            return (
              <tr key={b.key} className="border-t border-[#F3F4F6]">
                <td className="px-3 py-1.5">{b.key}</td>
                <td className="px-3 py-1.5 text-right">{b.deliveryCount.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right">{b.openCount.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right">{oRate.toFixed(1)}%</td>
                <td className="px-3 py-1.5 text-right">
                  {onApply && b.applyCount > 0 ? (
                    <button
                      onClick={() => onApply(b.key)}
                      className="text-[#2563EB] hover:underline"
                      title="応募者一覧を表示"
                    >
                      {b.applyCount.toLocaleString()}
                    </button>
                  ) : (
                    b.applyCount.toLocaleString()
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">{aRate.toFixed(2)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
