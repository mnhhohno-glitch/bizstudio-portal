"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import EntryTable from "./EntryTable";
import EntryDetailModal from "./EntryDetailModal";
import EntryCreateModal from "./EntryCreateModal";
import BulkFlagChangeModal from "./BulkFlagChangeModal";
import EndNoticeModal from "./EndNoticeModal";

export type Entry = {
  id: string;
  candidateId: string;
  candidate: { id: string; name: string; candidateNumber: string; employeeId?: string; employee?: { name: string } | null };
  companyName: string;
  jobTitle: string;
  externalJobNo: string | null;
  jobDb: string | null;
  prefecture: string | null;
  jobCategory: string | null;
  status: string | null;
  entryFlag: string | null;
  entryFlagDetail: string | null;
  companyFlag: string | null;
  personFlag: string | null;
  hasJobPosting: boolean;
  hasEntry: boolean;
  hasJoined: boolean;
  entryDate: string;
  firstMeetingDate: string | null;
  jobMeetingDate: string | null;
  jobIntroDate: string | null;
  documentSubmitDate: string | null;
  documentPassDate: string | null;
  aptitudeTestExists: boolean;
  aptitudeTestDeadline: string | null;
  interviewPrepDate: string | null;
  interviewPrepTime: string | null;
  firstInterviewDate: string | null;
  firstInterviewTime: string | null;
  finalInterviewDate: string | null;
  finalInterviewTime: string | null;
  offerDate: string | null;
  offerDeadline: string | null;
  offerMeetingDate: string | null;
  offerMeetingTime: string | null;
  acceptanceDate: string | null;
  joinDate: string | null;
  memo: string | null;
  isActive: boolean;
  careerAdvisorId: string | null;
  introducedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type FlagData = {
  entryFlags: string[];
  entryDetails: Record<string, string[]>;
  personFlags: Record<string, string[]>;
  companyFlags: Record<string, string[]>;
};

const TABS = [
  { key: "求人紹介", label: "求人紹介" },
  { key: "エントリー", label: "エントリー" },
  { key: "書類選考", label: "書類選考" },
  { key: "面接", label: "面接" },
  { key: "内定", label: "内定" },
  { key: "入社済", label: "入社済" },
  { key: "全件", label: "全件" },
];

export default function EntryBoard() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("全件");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [flagData, setFlagData] = useState<FlagData | null>(null);

  // Filters
  const [candidateName, setCandidateName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);

  // Sort
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modals
  const [detailEntryId, setDetailEntryId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showBulkFlags, setShowBulkFlags] = useState(false);
  const [showEndNotice, setShowEndNotice] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "50");
    if (activeTab !== "全件" && activeTab !== "入社済") params.set("entryFlag", activeTab);
    if (activeTab === "入社済") params.set("hasJoined", "true");
    if (candidateName) params.set("candidateName", candidateName);
    if (companyName) params.set("companyName", companyName);
    if (includeInactive) params.set("includeInactive", "true");

    try {
      const res = await fetch(`/api/entries?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
        setTotalPages(data.totalPages || 1);
        setCounts(data.counts || {});
      }
    } catch { /* */ }
    finally { setLoading(false); }
  }, [page, activeTab, candidateName, companyName, includeInactive]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  useEffect(() => {
    fetch("/api/entry-flags")
      .then((r) => r.json())
      .then(setFlagData)
      .catch(() => {});
  }, []);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setPage(1);
  };

  const handleFlagUpdate = async (entryId: string, flags: Record<string, string | null>) => {
    try {
      const res = await fetch(`/api/entries/${entryId}/flags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(flags),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "更新に失敗しました");
        return;
      }
      const data = await res.json();
      setEntries((prev) => prev.map((e) => (e.id === entryId ? data.entry : e)));
      // Refresh counts
      fetchEntries();
    } catch {
      toast.error("更新に失敗しました");
    }
  };

  const handleFieldUpdate = async (entryId: string, fields: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        toast.error("更新に失敗しました");
        return;
      }
      const data = await res.json();
      setEntries((prev) => prev.map((e) => (e.id === entryId ? data.entry : e)));
    } catch {
      toast.error("更新に失敗しました");
    }
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortField(null); setSortDir("asc"); }
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    if (activeTab !== "全件" && activeTab !== "入社済") params.set("entryFlag", activeTab);
    if (activeTab === "入社済") params.set("hasJoined", "true");
    if (candidateName) params.set("candidateName", candidateName);
    if (companyName) params.set("companyName", companyName);
    if (includeInactive) params.set("includeInactive", "true");
    window.open(`/api/entries/export?${params}`, "_blank");
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-[#374151]">エントリー管理</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#1D4ED8]"
          >
            + 新規登録
          </button>
          <button
            onClick={handleExport}
            className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            CSV
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-4 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? "text-[#2563EB] border-[#2563EB]"
                : "text-gray-500 hover:text-gray-700 border-transparent"
            }`}
          >
            {tab.label}
            {counts[tab.key] != null && (
              <span className="ml-1 text-xs bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5">
                {counts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          value={candidateName}
          onChange={(e) => { setCandidateName(e.target.value); setPage(1); }}
          placeholder="求職者名で検索"
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#2563EB] w-40"
        />
        <input
          type="text"
          value={companyName}
          onChange={(e) => { setCompanyName(e.target.value); setPage(1); }}
          placeholder="企業名で検索"
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#2563EB] w-40"
        />
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => { setIncludeInactive(e.target.checked); setPage(1); }}
            className="rounded border-gray-300 text-[#2563EB]"
          />
          無効も表示
        </label>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (() => {
        const selectedEntries = entries.filter((e) => selectedIds.has(e.id));
        const candidateIds = new Set(selectedEntries.map((e) => e.candidateId));
        const isSameCandidate = candidateIds.size === 1;
        return (
          <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-md">
            <span className="text-sm font-medium text-[#2563EB]">✓ {selectedIds.size}件選択中</span>
            <button
              onClick={() => setShowBulkFlags(true)}
              className="bg-[#2563EB] text-white rounded-md px-3 py-1 text-sm font-medium hover:bg-[#1D4ED8]"
            >
              一括フラグ変更
            </button>
            <button
              onClick={() => setShowEndNotice(true)}
              disabled={!isSameCandidate}
              title={!isSameCandidate ? "同一求職者のレコードのみ選択してください" : ""}
              className="border border-orange-400 text-orange-600 rounded-md px-3 py-1 text-sm font-medium hover:bg-orange-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              📝 選考終了案内
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              選択解除
            </button>
          </div>
        );
      })()}

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">読み込み中...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">該当するエントリーがありません</div>
      ) : (
        <EntryTable
          entries={entries}
          flagData={flagData}
          activeTab={activeTab}
          sortField={sortField}
          sortDir={sortDir}
          onSort={handleSort}
          onFlagUpdate={handleFlagUpdate}
          onFieldUpdate={handleFieldUpdate}
          onRowClick={(id) => setDetailEntryId(id)}
          selectedIds={selectedIds}
          onSelectToggle={(id) => setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
          onSelectAll={(ids) => setSelectedIds(new Set(ids))}
          onDeselectAll={() => setSelectedIds(new Set())}
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 text-sm border rounded disabled:opacity-50"
          >
            &lt;
          </button>
          <span className="text-sm text-gray-600">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 text-sm border rounded disabled:opacity-50"
          >
            &gt;
          </button>
        </div>
      )}

      {/* Detail Modal */}
      {detailEntryId && flagData && (
        <EntryDetailModal
          entryId={detailEntryId}
          flagData={flagData}
          onClose={() => setDetailEntryId(null)}
          onSaved={fetchEntries}
        />
      )}

      {/* Create Modal */}
      {showCreate && flagData && (
        <EntryCreateModal
          flagData={flagData}
          onClose={() => setShowCreate(false)}
          onCreated={fetchEntries}
        />
      )}

      {/* Bulk Flag Change Modal */}
      {showBulkFlags && flagData && (
        <BulkFlagChangeModal
          selectedCount={selectedIds.size}
          selectedIds={Array.from(selectedIds)}
          flagData={flagData}
          onClose={() => setShowBulkFlags(false)}
          onDone={() => { setShowBulkFlags(false); setSelectedIds(new Set()); fetchEntries(); }}
        />
      )}

      {/* End Notice Modal */}
      {showEndNotice && (
        <EndNoticeModal
          selectedEntries={entries.filter((e) => selectedIds.has(e.id))}
          onClose={() => setShowEndNotice(false)}
          onDone={() => { setShowEndNotice(false); setSelectedIds(new Set()); fetchEntries(); }}
        />
      )}
    </div>
  );
}
