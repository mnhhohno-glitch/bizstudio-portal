"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { Table, TableWrap, Th, Td } from "@/components/ui/Table";
import { toast } from "sonner";
import CandidateRegistrationModal from "./CandidateRegistrationModal";
import SupportEndModal from "@/components/candidates/SupportEndModal";
import { REASON_LABEL_MAP } from "@/lib/constants/support-end-reasons";

const SUPPORT_TABS = [
  { key: "ALL", label: "ALL" },
  { key: "ACTIVE", label: "支援中" },
  { key: "ENDED", label: "支援終了" },
  { key: "BEFORE", label: "支援前" },
] as const;

const SUPPORT_BADGE: Record<string, { label: string; cls: string }> = {
  BEFORE: { label: "支援前", cls: "bg-gray-100 text-gray-600" },
  ACTIVE: { label: "支援中", cls: "bg-blue-100 text-blue-700" },
  ENDED: { label: "支援終了", cls: "bg-red-100 text-red-600" },
};

type Employee = {
  id: string;
  employeeNumber: string;
  name: string;
};

type CandidateRow = {
  id: string;
  candidateNumber: string;
  name: string;
  nameKana: string | null;
  gender: string | null;
  employee: { id: string; name: string } | null;
  createdAt: string;
  supportStatus: string;
  supportEndReason: string | null;
  jobStatus?: "entry" | null;
};

interface CandidateListClientProps {
  initialCandidates: CandidateRow[];
  initialTotalCount: number;
  employees: Employee[];
}

const PAGE_SIZE = 20;

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString("ja-JP");
}

function formatGender(gender: string | null) {
  if (!gender) return "-";
  switch (gender) {
    case "male":
      return "男性";
    case "female":
      return "女性";
    case "other":
      return "その他";
    default:
      return "-";
  }
}

export default function CandidateListClient({
  initialCandidates,
  initialTotalCount,
  employees,
}: CandidateListClientProps) {
  const [candidates, setCandidates] = useState<CandidateRow[]>(initialCandidates);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [supportTab, setSupportTab] = useState("ALL");
  const [endModalCandidateId, setEndModalCandidateId] = useState<string | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  const filtered = useMemo(() => {
    let result = candidates;
    if (supportTab !== "ALL") {
      result = result.filter((c) => c.supportStatus === supportTab);
    }
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase();
      result = result.filter(
        (c) =>
          c.candidateNumber.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          (c.nameKana && c.nameKana.toLowerCase().includes(q)) ||
          (c.employee?.name && c.employee.name.toLowerCase().includes(q))
      );
    }
    return result;
  }, [candidates, debouncedSearch, supportTab]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: candidates.length, BEFORE: 0, ACTIVE: 0, ENDED: 0 };
    for (const c of candidates) { counts[c.supportStatus] = (counts[c.supportStatus] || 0) + 1; }
    return counts;
  }, [candidates]);

  const handleSupportStatusChange = async (candidateId: string, newStatus: string) => {
    if (newStatus === "ENDED") {
      setEndModalCandidateId(candidateId);
      return;
    }
    try {
      const res = await fetch(`/api/candidates/${candidateId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supportStatus: newStatus }),
      });
      if (res.ok) {
        setCandidates((prev) => prev.map((c) => c.id === candidateId ? { ...c, supportStatus: newStatus, supportEndReason: null } : c));
        toast.success("更新しました");
      }
    } catch { toast.error("更新に失敗しました"); }
  };

  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const skip = (safePage - 1) * PAGE_SIZE;
  const pageData = filtered.slice(skip, skip + PAGE_SIZE);

  const refreshCandidates = useCallback(async () => {
    try {
      const res = await fetch("/api/master/candidates?include=employee");
      if (res.ok) {
        const data = await res.json();
        setCandidates(data.candidates);
        setTotalCount(data.total);
      }
    } catch {
      // silent
    }
  }, []);

  const displayTotal = debouncedSearch.trim() ? totalFiltered : totalCount;
  const displayStart = totalFiltered > 0 ? skip + 1 : 0;
  const displayEnd = Math.min(skip + PAGE_SIZE, totalFiltered);

  return (
    <>
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-semibold text-[#374151]">
            求職者管理
          </h1>
          <p className="mt-2 text-[14px] text-[#374151]/80">
            求職者の基本情報を管理します
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors"
        >
          + 新規登録
        </button>
      </div>

      {/* 支援ステータスタブ */}
      <div className="mt-4 flex border-b border-gray-200">
        {SUPPORT_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setSupportTab(tab.key); setCurrentPage(1); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              supportTab === tab.key
                ? "text-[#2563EB] border-[#2563EB]"
                : "text-gray-500 hover:text-gray-700 border-transparent"
            }`}
          >
            {tab.label}
            <span className="ml-1.5 text-xs bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5">
              {tabCounts[tab.key] || 0}
            </span>
          </button>
        ))}
      </div>

      {/* 検索バー */}
      <div className="mt-4">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
            🔍
          </span>
          <input
            type="text"
            placeholder="求職者ID、氏名、担当CAで検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-lg pl-9 pr-4 py-3 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
          />
        </div>
      </div>

      {/* テーブル */}
      <div className="mt-4 rounded-[8px] border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        <div className="p-4">
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>求職者番号</Th>
                  <Th>氏名</Th>
                  <Th>フリガナ</Th>
                  <Th>性別</Th>
                  <Th>担当CA</Th>
                  <Th>登録日時</Th>
                  <Th>支援状況</Th>
                  <Th>ステータス</Th>
                </tr>
              </thead>
              <tbody>
                {pageData.map((cand) => (
                  <tr key={cand.id}>
                    <Td>
                      <span className="font-mono text-[13px]">
                        {cand.candidateNumber}
                      </span>
                    </Td>
                    <Td>
                      <Link
                        href={`/candidates/${cand.id}`}
                        className="text-[#2563EB] hover:underline cursor-pointer"
                      >
                        {cand.name}
                      </Link>
                    </Td>
                    <Td>
                      <span className="text-[13px] text-[#374151]/70">
                        {cand.nameKana || "-"}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-[13px]">
                        {formatGender(cand.gender)}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-[13px]">
                        {cand.employee?.name || "-"}
                      </span>
                    </Td>
                    <Td>
                      <span className="font-mono text-[12px] text-[#374151]/70">
                        {formatDate(cand.createdAt)}
                      </span>
                    </Td>
                    <Td>
                      <select
                        value={cand.supportStatus}
                        onChange={(e) => handleSupportStatusChange(cand.id, e.target.value)}
                        title={cand.supportEndReason ? REASON_LABEL_MAP[cand.supportEndReason] || "" : ""}
                        className={`text-xs px-2 py-0.5 rounded-full border-0 cursor-pointer ${SUPPORT_BADGE[cand.supportStatus]?.cls || "bg-gray-100 text-gray-600"}`}
                      >
                        <option value="BEFORE">支援前</option>
                        <option value="ACTIVE">支援中</option>
                        <option value="ENDED">{cand.supportEndReason ? `支援終了（${REASON_LABEL_MAP[cand.supportEndReason] || ""}）` : "支援終了"}</option>
                      </select>
                    </Td>
                    <Td>
                      {cand.jobStatus === "entry" && (
                        <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                          エントリー
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
                {pageData.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-8 text-center text-[14px] text-[#374151]/60"
                    >
                      {debouncedSearch.trim()
                        ? "該当する求職者が見つかりません"
                        : "求職者が登録されていません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </TableWrap>

          {/* ページネーション */}
          <div className="mt-4 flex items-center justify-between border-t border-[#E5E7EB] pt-4">
            <div className="text-[13px] text-[#374151]/70">
              {debouncedSearch.trim() && (
                <span className="mr-2 text-[#2563EB]">
                  検索結果: {totalFiltered}件 /
                </span>
              )}
              全 {displayTotal.toLocaleString()} 件中{" "}
              {totalFiltered > 0
                ? `${displayStart}〜${displayEnd} 件を表示`
                : "0 件"}
            </div>
            <div className="flex items-center gap-2">
              {safePage > 1 ? (
                <button
                  onClick={() => setCurrentPage(safePage - 1)}
                  className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F5F7FA]"
                >
                  前へ
                </button>
              ) : (
                <span className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#374151]/40">
                  前へ
                </span>
              )}
              <span className="text-[13px] text-[#374151]">
                {safePage} / {totalPages}
              </span>
              {safePage < totalPages ? (
                <button
                  onClick={() => setCurrentPage(safePage + 1)}
                  className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F5F7FA]"
                >
                  次へ
                </button>
              ) : (
                <span className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#374151]/40">
                  次へ
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 新規登録モーダル */}
      <CandidateRegistrationModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        employees={employees}
        onCreated={refreshCandidates}
      />
      {endModalCandidateId && (
        <SupportEndModal
          candidateId={endModalCandidateId}
          onClose={() => setEndModalCandidateId(null)}
          onSaved={() => { setEndModalCandidateId(null); refreshCandidates(); }}
        />
      )}
    </>
  );
}
