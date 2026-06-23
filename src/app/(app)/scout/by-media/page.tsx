"use client";

import { useEffect, useState, useCallback } from "react";
import ScoutNav from "@/components/scout/ScoutNav";
import { formatRecruiterName } from "@/lib/recruiterDisplay";
import ApplicantListModal, { type ApplicantQuery } from "@/components/scout/ApplicantListModal";

type Bucket = { key: string; deliveryCount: number; openCount: number; applyCount: number };
type Stats = { subBuckets: Record<string, Bucket[]> };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

export default function ByMediaPage() {
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [mediaStats, setMediaStats] = useState<Stats | null>(null);
  const [machineStats, setMachineStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [modalQuery, setModalQuery] = useState<ApplicantQuery | null>(null);
  const [modalTitle, setModalTitle] = useState("");

  const openMedia = useCallback(
    (mediaKey: string) => {
      setModalQuery({ media: mediaKey, from, to });
      setModalTitle(`${mediaKey}（期間内）の応募者`);
    },
    [from, to],
  );
  const openAccount = useCallback(
    (machineLabel: string) => {
      setModalQuery({ machineLabel, from, to });
      setModalTitle(`${formatRecruiterName(machineLabel)}（期間内）の応募者`);
    },
    [from, to],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [m1, m2] = await Promise.all([
      fetch(`/api/scout/stats?axis=media&from=${from}&to=${to}&groupBy=day&dateMode=sent`).then(
        (r) => r.json(),
      ),
      fetch(`/api/scout/stats?axis=machine&from=${from}&to=${to}&groupBy=day&dateMode=sent`).then(
        (r) => r.json(),
      ),
    ]);
    setMediaStats(m1);
    setMachineStats(m2);
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const summarize = (stats: Stats | null) => {
    if (!stats) return [];
    return Object.entries(stats.subBuckets).map(([key, buckets]) => {
      const totals = buckets.reduce(
        (acc, b) => ({
          d: acc.d + b.deliveryCount,
          o: acc.o + b.openCount,
          a: acc.a + b.applyCount,
        }),
        { d: 0, o: 0, a: 0 },
      );
      return { key, ...totals };
    });
  };

  return (
    <div>
      <ScoutNav />
      <h1 className="text-[20px] font-bold text-[#374151]">媒体・アカウント別集計</h1>

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
      </div>

      {loading ? (
        <p className="mt-6 text-[#9CA3AF]">読み込み中...</p>
      ) : (
        <>
          <Section title="媒体別" rows={summarize(mediaStats)} showTotals={false} onApply={openMedia} />
          <Section title="アカウント別（号機・社員）" rows={summarize(machineStats)} showTotals onApply={openAccount} />
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

function Section({
  title,
  rows,
  showTotals,
  onApply,
}: {
  title: string;
  rows: Array<{ key: string; d: number; o: number; a: number }>;
  showTotals: boolean;
  onApply: (key: string) => void;
}) {
  const totals = rows.reduce((acc, r) => ({ d: acc.d + r.d, o: acc.o + r.o, a: acc.a + r.a }), { d: 0, o: 0, a: 0 });
  const pct = (num: number, den: number) => (den > 0 ? ((num / den) * 100).toFixed(1) : "0.0");
  const headCls = "sticky top-0 z-20 bg-[#F9FAFB] px-3 py-2";
  const totalCls = "sticky top-[35px] z-10 border-b-2 border-[#9CA3AF] bg-[#EFF6FF] px-3 py-2";
  return (
    <div className="mt-6">
      <h2 className="text-[14px] font-semibold text-[#374151] mb-2">{title}</h2>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-[#E5E7EB] bg-white">
        <table className="w-full text-[13px]">
          <thead className="text-[#6B7280]">
            <tr>
              <th className={`${headCls} text-left`}>名称</th>
              <th className={`${headCls} text-right`}>配信</th>
              <th className={`${headCls} text-right`}>開封</th>
              <th className={`${headCls} text-right`}>開封率</th>
              <th className={`${headCls} text-right`}>応募</th>
              <th className={`${headCls} text-right`}>応募率</th>
            </tr>
            {/* アカウント別のみ上部合計行（ヘッダー直下固定）。率は Σ/Σ で再計算。 */}
            {showTotals && rows.length > 0 && (
              <tr className="font-medium text-[#374151]">
                <td className={totalCls}>合計</td>
                <td className={`${totalCls} text-right`}>{totals.d.toLocaleString()}</td>
                <td className={`${totalCls} text-right`}>{totals.o.toLocaleString()}</td>
                <td className={`${totalCls} text-right`}>{pct(totals.o, totals.d)}%</td>
                <td className={`${totalCls} text-right`}>{totals.a.toLocaleString()}</td>
                <td className={`${totalCls} text-right`}>{pct(totals.a, totals.d)}%</td>
              </tr>
            )}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[#9CA3AF]">
                  データがありません
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.key} className="border-t border-[#F3F4F6]">
                  <td className="px-3 py-1.5">{formatRecruiterName(r.key)}</td>
                  <td className="px-3 py-1.5 text-right">{r.d.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">{r.o.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">{pct(r.o, r.d)}%</td>
                  <td className="px-3 py-1.5 text-right">
                    {r.a > 0 ? (
                      <button onClick={() => onApply(r.key)} className="text-[#2563EB] hover:underline" title="応募者一覧を表示">
                        {r.a.toLocaleString()}
                      </button>
                    ) : (
                      r.a.toLocaleString()
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">{pct(r.a, r.d)}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
