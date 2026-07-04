"use client";

import { useEffect, useState, useCallback } from "react";
import { formatRecruiterName } from "@/lib/recruiterDisplay";
import ApplicantListModal, { type ApplicantQuery } from "@/components/scout/ApplicantListModal";

// T-135 T-C: 旧 /scout/by-media のロジックをビューコンポーネントへ抽出。
// axis=media と axis=machine の2回並行フェッチ・2テーブル並列という固有ロジックをこの中に閉じる。
// 期間（from/to）は統合ページから props で受け取る。
type Bucket = { key: string; deliveryCount: number; openCount: number; applyCount: number };
type Stats = { subBuckets: Record<string, Bucket[]> };

export default function MediaView({ from, to }: { from: string; to: string }) {
  const [mediaStats, setMediaStats] = useState<Stats | null>(null);
  const [machineStats, setMachineStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/scout/stats?axis=media&from=${from}&to=${to}&groupBy=day&dateMode=sent`).then((r) => r.json()),
      fetch(`/api/scout/stats?axis=machine&from=${from}&to=${to}&groupBy=day&dateMode=sent`).then((r) => r.json()),
    ])
      .then(([m1, m2]) => {
        if (active) {
          setMediaStats(m1);
          setMachineStats(m2);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [from, to]);

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
  // T-064 step40: 応募率は小数第2位（開封率は第1位を維持）
  const pctApply = (num: number, den: number) => (den > 0 ? ((num / den) * 100).toFixed(2) : "0.00");
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
            {showTotals && rows.length > 0 && (
              <tr className="font-medium text-[#374151]">
                <td className={totalCls}>合計</td>
                <td className={`${totalCls} text-right`}>{totals.d.toLocaleString()}</td>
                <td className={`${totalCls} text-right`}>{totals.o.toLocaleString()}</td>
                <td className={`${totalCls} text-right`}>{pct(totals.o, totals.d)}%</td>
                <td className={`${totalCls} text-right`}>{totals.a.toLocaleString()}</td>
                <td className={`${totalCls} text-right`}>{pctApply(totals.a, totals.d)}%</td>
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
                  <td className="px-3 py-1.5 text-right">{pctApply(r.a, r.d)}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
