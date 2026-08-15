"use client";

import { useCallback, useEffect, useState } from "react";
import { Toaster } from "sonner";
import { PageTitle } from "@/components/ui/PageTitle";
import { Table, TableWrap, Th, Td } from "@/components/ui/Table";
import { fmtJstDateTime, type RpaLog } from "./types";

type SortKey = "recordedAt" | "machineNo" | "searchCount";

export default function LogsClient() {
  const [logs, setLogs] = useState<RpaLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [machineNo, setMachineNo] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [patternName, setPatternName] = useState("");
  const [sort, setSort] = useState<SortKey>("recordedAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), sort, order });
    if (machineNo) params.set("machineNo", machineNo);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (patternName) params.set("patternName", patternName);
    const res = await fetch(`/api/rpa-scout/logs?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    }
    setLoading(false);
  }, [page, sort, order, machineNo, from, to, patternName]);

  useEffect(() => {
    load();
  }, [load]);

  const onSort = (key: SortKey) => {
    if (sort === key) setOrder(order === "asc" ? "desc" : "asc");
    else {
      setSort(key);
      setOrder(key === "recordedAt" ? "desc" : "asc");
    }
    setPage(1);
  };

  const SortTh = ({ label, k }: { label: string; k: SortKey }) => (
    <Th>
      <button onClick={() => onSort(k)} className="flex items-center gap-0.5 hover:text-[#2563EB]">
        {label}
        {sort === k ? <span>{order === "asc" ? "▲" : "▼"}</span> : null}
      </button>
    </Th>
  );

  const pageButtons = () => {
    const items: (number | "...")[] = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) items.push(i);
      else if (items[items.length - 1] !== "...") items.push("...");
    }
    return items;
  };

  return (
    <div>
      <Toaster position="top-center" richColors />
      <div className="mb-4 flex items-center justify-between">
        <PageTitle>変更ログ一覧</PageTitle>
        <span className="text-[13px] text-[#6B7280]">{total.toLocaleString()}件</span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
        <select
          value={machineNo}
          onChange={(e) => {
            setMachineNo(e.target.value);
            setPage(1);
          }}
          className="rounded-[6px] border border-[#D1D5DB] px-2 py-1.5"
        >
          <option value="">全ての号機</option>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}号機
            </option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
          className="rounded-[6px] border border-[#D1D5DB] px-2 py-1"
        />
        <span className="text-[#6B7280]">〜</span>
        <input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
          className="rounded-[6px] border border-[#D1D5DB] px-2 py-1"
        />
        <input
          type="text"
          placeholder="パターン名で絞り込み"
          value={patternName}
          onChange={(e) => {
            setPatternName(e.target.value);
            setPage(1);
          }}
          className="w-56 rounded-[6px] border border-[#D1D5DB] px-2 py-1.5"
        />
      </div>

      <div className="rounded-[8px] border border-[#E5E7EB] bg-white">
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <SortTh label="記録日時" k="recordedAt" />
                <SortTh label="号機" k="machineNo" />
                <Th>パターン名</Th>
                <Th>件名</Th>
                <SortTh label="検索件数" k="searchCount" />
                <Th>記録者</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-[#9CA3AF]">
                    読み込み中...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-[#9CA3AF]">
                    ログがありません
                  </td>
                </tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id}>
                    <Td className="whitespace-nowrap">{fmtJstDateTime(l.recordedAt)}</Td>
                    <Td className="whitespace-nowrap">{l.machineNo}号機</Td>
                    <Td className="max-w-[320px]">
                      <span className="break-all">{l.patternName}</span>
                    </Td>
                    <Td className="max-w-[280px]">
                      <span className="break-all">{l.subjectName}</span>
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      {l.searchCount != null ? l.searchCount.toLocaleString() : "-"}
                    </Td>
                    <Td className="whitespace-nowrap">{l.recordedByName ?? "-"}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </TableWrap>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-1 text-[13px]">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="rounded border border-[#D1D5DB] px-3 py-1 disabled:opacity-40"
          >
            前へ
          </button>
          {pageButtons().map((it, i) =>
            it === "..." ? (
              <span key={`e${i}`} className="px-1 text-[#9CA3AF]">
                ...
              </span>
            ) : (
              <button
                key={it}
                onClick={() => setPage(it)}
                className={[
                  "rounded border px-3 py-1",
                  it === page
                    ? "border-[#2563EB] bg-[#EFF6FF] font-medium text-[#2563EB]"
                    : "border-[#D1D5DB]",
                ].join(" ")}
              >
                {it}
              </button>
            )
          )}
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="rounded border border-[#D1D5DB] px-3 py-1 disabled:opacity-40"
          >
            次へ
          </button>
        </div>
      )}
    </div>
  );
}
