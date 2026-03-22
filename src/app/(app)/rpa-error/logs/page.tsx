"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

type ErrorLog = {
  id: string;
  machineNumber: number;
  flowName: string;
  errorSummary: string;
  status: string;
  severity: string | null;
  occurredAt: string;
  registeredUser: { name: string };
  knownError: { patternName: string } | null;
};

const STATUS_STYLE: Record<string, string> = {
  "未対応": "border-[#DC2626]/30 bg-[#DC2626]/10 text-[#DC2626]",
  "対応中": "border-[#D97706]/30 bg-[#D97706]/10 text-[#D97706]",
  "解決済み": "border-[#16A34A]/30 bg-[#16A34A]/10 text-[#16A34A]",
};

const SEVERITY_STYLE: Record<string, string> = {
  "緊急": "text-[#DC2626] font-semibold",
  "要対応": "text-[#D97706]",
  "放置OK": "text-[#9CA3AF]",
};

export default function RpaErrorLogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<ErrorLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState({ machineNumber: "", status: "" });
  const [loading, setLoading] = useState(true);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    if (filters.machineNumber) params.set("machineNumber", filters.machineNumber);
    if (filters.status) params.set("status", filters.status);

    const res = await fetch(`/api/rpa-error/logs?${params}`);
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    }
    setLoading(false);
  }, [page, filters]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const updateStatus = async (id: string, newStatus: string) => {
    await fetch(`/api/rpa-error/logs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    loadLogs();
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-[#374151]">RPAエラー一覧</h1>
          <p className="text-[13px] text-[#6B7280]">全{total}件</p>
        </div>
        <a href="/rpa-error/chat" className="rounded-md bg-[#2563EB] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#1D4ED8]">
          エラー相談チャット
        </a>
      </div>

      {/* フィルター */}
      <div className="mt-4 flex gap-3">
        <select
          value={filters.machineNumber}
          onChange={(e) => { setFilters({ ...filters, machineNumber: e.target.value }); setPage(1); }}
          className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]"
        >
          <option value="">全号機</option>
          {[1,2,3,4,5,6,7].map((n) => <option key={n} value={n}>{n}号機</option>)}
        </select>
        <select
          value={filters.status}
          onChange={(e) => { setFilters({ ...filters, status: e.target.value }); setPage(1); }}
          className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]"
        >
          <option value="">全ステータス</option>
          <option value="未対応">未対応</option>
          <option value="対応中">対応中</option>
          <option value="解決済み">解決済み</option>
        </select>
      </div>

      {/* テーブル */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white">
        <table className="w-full text-[14px]">
          <thead className="bg-[#F9FAFB] text-[#6B7280] text-[13px]">
            <tr>
              <th className="px-4 py-3 text-left font-medium">登録日時</th>
              <th className="px-4 py-3 text-left font-medium">号機</th>
              <th className="px-4 py-3 text-left font-medium">フロー名</th>
              <th className="px-4 py-3 text-left font-medium">エラー概要</th>
              <th className="px-4 py-3 text-left font-medium">深刻度</th>
              <th className="px-4 py-3 text-left font-medium">ステータス</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-[#9CA3AF]">読み込み中...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-[#9CA3AF]">エラーログがありません</td></tr>
            ) : logs.map((log) => (
              <tr
                key={log.id}
                className="border-t border-[#F3F4F6] hover:bg-[#F9FAFB] cursor-pointer"
                onClick={() => router.push(`/rpa-error/logs/${log.id}`)}
              >
                <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">
                  {new Date(log.occurredAt).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="px-4 py-3">{log.machineNumber}号機</td>
                <td className="px-4 py-3 text-[13px]">{log.flowName}</td>
                <td className="px-4 py-3 max-w-xs truncate">{log.errorSummary}</td>
                <td className="px-4 py-3">
                  <span className={SEVERITY_STYLE[log.severity || ""] || "text-[#9CA3AF]"}>
                    {log.severity || "—"}
                  </span>
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={log.status}
                    onChange={(e) => updateStatus(log.id, e.target.value)}
                    className={`rounded-full border px-2 py-0.5 text-[12px] ${STATUS_STYLE[log.status] || ""}`}
                  >
                    <option value="未対応">未対応</option>
                    <option value="対応中">対応中</option>
                    <option value="解決済み">解決済み</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ページネーション */}
      {totalPages > 1 && (
        <div className="mt-4 flex justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border px-3 py-1 text-[13px] disabled:opacity-40">前へ</button>
          <span className="px-3 py-1 text-[13px] text-[#6B7280]">{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded border px-3 py-1 text-[13px] disabled:opacity-40">次へ</button>
        </div>
      )}
    </div>
  );
}
