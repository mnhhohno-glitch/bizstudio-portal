"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import RpaErrorNav from "@/components/rpa-error/RpaErrorNav";
import { formatDateTimeJST } from "@/lib/rpa-error/formatDate";

type Batch = {
  id: string;
  machineNumber: number;
  flowName: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  totalCount: number;
  normalCount: number;
  ageNgCount: number;
  foreignNgCount: number;
  aiFailedCount: number;
  duplicateSkipCount: number;
  errorCount: number;
};

const STATUS_STYLE: Record<string, string> = {
  RUNNING: "border-[#2563EB]/30 bg-[#2563EB]/10 text-[#2563EB]",
  COMPLETED: "border-[#16A34A]/30 bg-[#16A34A]/10 text-[#16A34A]",
  FAILED: "border-[#DC2626]/30 bg-[#DC2626]/10 text-[#DC2626]",
};

const STATUS_LABEL: Record<string, string> = {
  RUNNING: "実行中",
  COMPLETED: "完了",
  FAILED: "失敗",
};

const TAKE = 20;

export default function RpaExecutionsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Batch[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [machineNumber, setMachineNumber] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("skip", String((page - 1) * TAKE));
    params.set("take", String(TAKE));
    if (machineNumber) params.set("machineNumber", machineNumber);

    const res = await fetch(`/api/rpa-error/executions?${params}`);
    if (res.ok) {
      const data = await res.json();
      setItems(data.items);
      setTotal(data.total);
    }
    setLoading(false);
  }, [page, machineNumber]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / TAKE));

  return (
    <div>
      <RpaErrorNav />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-[#374151]">RPA実行履歴</h1>
          <p className="text-[13px] text-[#6B7280]">全{total}件</p>
        </div>
      </div>

      {/* フィルター */}
      <div className="mt-4 flex gap-3">
        <select
          value={machineNumber}
          onChange={(e) => {
            setMachineNumber(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]"
        >
          <option value="">全号機</option>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <option key={n} value={n}>
              {n}号機
            </option>
          ))}
        </select>
      </div>

      {/* テーブル */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white">
        <table className="w-full text-[14px]">
          <thead className="bg-[#F9FAFB] text-[13px] text-[#6B7280]">
            <tr>
              <th className="px-4 py-3 text-left font-medium">実行日時</th>
              <th className="px-4 py-3 text-left font-medium">号機</th>
              <th className="px-4 py-3 text-left font-medium">フロー</th>
              <th className="px-4 py-3 text-left font-medium">状態</th>
              <th className="px-4 py-3 text-left font-medium">件数サマリ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[#9CA3AF]">
                  読み込み中...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[#9CA3AF]">
                  実行履歴がありません
                </td>
              </tr>
            ) : (
              items.map((b) => (
                <tr
                  key={b.id}
                  className="cursor-pointer border-t border-[#F3F4F6] hover:bg-[#F9FAFB]"
                  onClick={() => router.push(`/rpa-error/executions/${b.id}`)}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-[#6B7280]">
                    {formatDateTimeJST(b.startedAt)}
                  </td>
                  <td className="px-4 py-3">{b.machineNumber}号機</td>
                  <td className="px-4 py-3 text-[13px]">{b.flowName}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[12px] ${
                        STATUS_STYLE[b.status] || ""
                      }`}
                    >
                      {STATUS_LABEL[b.status] || b.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-[#374151]">
                    通常 {b.normalCount} / 年齢NG {b.ageNgCount} / 外国籍NG{" "}
                    {b.foreignNgCount} / AI失敗 {b.aiFailedCount} / 二重{" "}
                    {b.duplicateSkipCount} / エラー {b.errorCount}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ページネーション */}
      {totalPages > 1 && (
        <div className="mt-4 flex justify-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="rounded border px-3 py-1 text-[13px] disabled:opacity-40"
          >
            前へ
          </button>
          <span className="px-3 py-1 text-[13px] text-[#6B7280]">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="rounded border px-3 py-1 text-[13px] disabled:opacity-40"
          >
            次へ
          </button>
        </div>
      )}
    </div>
  );
}
