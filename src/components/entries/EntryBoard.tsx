"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import EntryTable from "./EntryTable";
import EntryDetailModal from "./EntryDetailModal";
import EntryCreateModal from "./EntryCreateModal";
import BulkFlagChangeModal from "./BulkFlagChangeModal";
import EndNoticeModal from "./EndNoticeModal";
import EntryRouteSwitchModal from "./EntryRouteSwitchModal";

export type Entry = {
  id: string;
  candidateId: string;
  candidate: { id: string; name: string; candidateNumber: string; employeeId?: string; employee?: { name: string } | null };
  companyName: string;
  jobTitle: string;
  externalJobNo: string | null;
  originalUrl: string | null;
  jobDb: string | null;
  jobDbUrl: string | null;
  jobType: string | null;
  entryRoute: string | null;
  entryJobId: string | null;
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
  archivedAt: string | null;
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
  const [activeTab, setActiveTab] = useState("エントリー");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [flagData, setFlagData] = useState<FlagData | null>(null);

  // Filters
  const [candidateName, setCandidateName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [caFilter, setCaFilter] = useState("");
  const [caOptions, setCaOptions] = useState<string[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);

  // Current user role (for admin-gated features)
  const [isAdmin, setIsAdmin] = useState(false);

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

  // URL edit modal
  const [urlModalEntryId, setUrlModalEntryId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);

  // Entry route switch modal
  const [routeModalEntry, setRouteModalEntry] = useState<Entry | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "50");
    if (activeTab !== "全件") params.set("entryFlag", activeTab);
    if (candidateName) params.set("candidateName", candidateName);
    if (companyName) params.set("companyName", companyName);
    if (caFilter) params.set("careerAdvisorName", caFilter);
    if (includeInactive) params.set("includeInactive", "true");
    if (includeArchived) params.set("includeArchived", "true");

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
  }, [page, activeTab, candidateName, companyName, caFilter, includeInactive, includeArchived]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  useEffect(() => {
    fetch("/api/entry-flags")
      .then((r) => r.json())
      .then(setFlagData)
      .catch(() => {});

    // Load CA list + session in parallel, then match login user to an
    // employee name (ignoring whitespace) to set the default filter.
    const normalize = (s: string) => s.replace(/\s+/g, "");
    Promise.all([
      fetch("/api/employees").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/auth/session").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([empData, session]) => {
      const list: { name: string }[] = empData?.employees || empData || [];
      const names = list.map((e) => e.name);
      setCaOptions(names);
      if (session?.role === "admin") setIsAdmin(true);
      if (session?.name) {
        const target = normalize(session.name);
        const match = names.find((n) => normalize(n) === target);
        setCaFilter(match ?? session.name);
      }
    });
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

  const openUrlEditModal = (entryId: string, currentUrl: string | null) => {
    setUrlModalEntryId(entryId);
    setUrlInput(currentUrl || "");
  };

  const handleBulkArchive = async (selectedEntries: Entry[]) => {
    const lines = selectedEntries
      .slice(0, 10)
      .map((e) => `・${e.candidate.name} / ${e.companyName}`)
      .join("\n");
    const more = selectedEntries.length > 10 ? `\n他${selectedEntries.length - 10}件...` : "";
    const msg = `選択した${selectedEntries.length}件のエントリーをアーカイブしますか？\n\nアーカイブしたエントリーは30日後に自動削除されます。管理者は即座に削除できます。\n\n対象:\n${lines}${more}`;
    if (!confirm(msg)) return;

    try {
      const res = await fetch("/api/entries/bulk-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds: selectedEntries.map((e) => e.id) }),
      });
      if (!res.ok) {
        toast.error("アーカイブに失敗しました");
        return;
      }
      const data = await res.json();
      toast.success(`${data.archived}件をアーカイブしました`);
      setSelectedIds(new Set());
      fetchEntries();
    } catch {
      toast.error("アーカイブに失敗しました");
    }
  };

  const handleUnarchive = async (entryId: string) => {
    try {
      const res = await fetch(`/api/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archivedAt: null }),
      });
      if (!res.ok) {
        toast.error("アーカイブ解除に失敗しました");
        return;
      }
      toast.success("アーカイブを解除しました");
      fetchEntries();
    } catch {
      toast.error("アーカイブ解除に失敗しました");
    }
  };

  const handleHardDelete = async (entry: Entry) => {
    if (!isAdmin) return;
    const msg = `この操作は取り消せません。\n\n以下のエントリーをデータベースから完全に削除しますか？\n\n・${entry.candidate.name} / ${entry.companyName}`;
    if (!confirm(msg)) return;
    try {
      const res = await fetch(`/api/entries/${entry.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("完全削除に失敗しました");
        return;
      }
      toast.success("完全に削除しました");
      fetchEntries();
    } catch {
      toast.error("完全削除に失敗しました");
    }
  };

  const handleCreateTasks = async (selectedEntries: Entry[]) => {
    const CATEGORY_NAME = "エントリー対応（求職者対応）";
    const CATEGORY_NAME_FALLBACK = "エントリー対応";

    // 求職者ごとにグルーピング
    const byCandidate = new Map<string, { name: string; candidateNumber: string; entries: Entry[] }>();
    for (const e of selectedEntries) {
      const existing = byCandidate.get(e.candidateId);
      if (existing) {
        existing.entries.push(e);
      } else {
        byCandidate.set(e.candidateId, {
          name: e.candidate.name,
          candidateNumber: e.candidate.candidateNumber,
          entries: [e],
        });
      }
    }

    // エントリー日: entries内で最新の日付を YYYY-MM-DD 形式で返す
    const latestEntryDate = (es: Entry[]): string => {
      const times = es
        .map((e) => (e.entryDate ? new Date(e.entryDate).getTime() : NaN))
        .filter((t) => !isNaN(t));
      if (times.length === 0) return "";
      const d = new Date(Math.max(...times));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };

    // コメント欄に入れる企業一覧
    const buildComment = (es: Entry[]): string =>
      es.map((e) => `■ ${e.companyName}${e.jobDb ? `（${e.jobDb}）` : ""}`).join("\n");

    // 1名のみ: タスク作成画面へ遷移
    if (byCandidate.size === 1) {
      const [candidateId, info] = [...byCandidate.entries()][0];
      const params = new URLSearchParams({
        prefill: "entry",
        candidateId,
        categoryName: CATEGORY_NAME,
        assignees: "1000025,1000007",
        title: `エントリー対応依頼 - ${info.name}`,
        entryDate: latestEntryDate(info.entries),
        entryCount: String(info.entries.length),
        entryComment: buildComment(info.entries),
        step: "5",
      });
      window.location.href = `/tasks/new?${params.toString()}`;
      return;
    }

    // 複数名: APIを直接叩いて一括作成
    try {
      const [catRes, empRes] = await Promise.all([
        fetch("/api/task-categories?includeFields=true"),
        fetch("/api/employees"),
      ]);
      const catJson = await catRes.json();
      const empJson = await empRes.json();
      type CatField = { id: string; label: string };
      type Cat = { id: string; name: string; fields: CatField[] };
      const categories: Cat[] = catJson.categories || [];
      const employees: { id: string; employeeNo: string }[] = Array.isArray(empJson) ? empJson : [];
      const category =
        categories.find((c) => c.name === CATEGORY_NAME) ||
        categories.find((c) => c.name === CATEGORY_NAME_FALLBACK) ||
        categories.find((c) => c.name.includes("エントリー対応"));
      if (!category) {
        toast.error("カテゴリ「エントリー対応（求職者対応）」が見つかりません");
        return;
      }
      const assigneeIds = ["1000025", "1000007"]
        .map((num) => employees.find((e) => e.employeeNo === num)?.id)
        .filter((id): id is string => !!id);
      if (assigneeIds.length === 0) {
        toast.error("担当者が見つかりません");
        return;
      }

      // テンプレートフィールドのID解決
      const entryDateField = category.fields.find((f) => f.label === "エントリー日");
      const entryCountField = category.fields.find((f) => f.label === "エントリー件数");
      const commentField = category.fields.find((f) => f.label === "コメント");

      let ok = 0;
      let fail = 0;
      for (const [cid, info] of byCandidate.entries()) {
        const fieldValues: { fieldId: string; value: string }[] = [];
        if (entryDateField) fieldValues.push({ fieldId: entryDateField.id, value: latestEntryDate(info.entries) });
        if (entryCountField) fieldValues.push({ fieldId: entryCountField.id, value: String(info.entries.length) });
        if (commentField) fieldValues.push({ fieldId: commentField.id, value: buildComment(info.entries) });

        try {
          const res = await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: `エントリー対応依頼 - ${info.name}`,
              categoryId: category.id,
              candidateId: cid,
              priority: "MEDIUM",
              assigneeIds,
              completionType: "any",
              fieldValues,
            }),
          });
          if (res.ok) ok++;
          else fail++;
        } catch {
          fail++;
        }
      }
      if (fail === 0) {
        toast.success(`${ok}件のエントリータスクを作成しました`);
        setSelectedIds(new Set());
      } else {
        toast.error(`${ok}件成功、${fail}件失敗しました`);
      }
    } catch {
      toast.error("タスク作成に失敗しました");
    }
  };

  const saveJobDbUrl = async () => {
    if (!urlModalEntryId) return;
    setSavingUrl(true);
    try {
      const res = await fetch(`/api/entries/${urlModalEntryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDbUrl: urlInput.trim() || null }),
      });
      if (!res.ok) { toast.error("保存に失敗しました"); return; }
      const data = await res.json();
      setEntries((prev) => prev.map((e) => (e.id === urlModalEntryId ? { ...e, jobDbUrl: data.entry.jobDbUrl } : e)));
      setUrlModalEntryId(null);
      setUrlInput("");
    } catch {
      toast.error("保存に失敗しました");
    } finally {
      setSavingUrl(false);
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
    if (activeTab !== "全件") params.set("entryFlag", activeTab);
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
        <select
          value={caFilter}
          onChange={(e) => { setCaFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
        >
          <option value="">担当CA（全員）</option>
          {caOptions.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
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
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => { setIncludeArchived(e.target.checked); setPage(1); }}
            className="rounded border-gray-300 text-[#2563EB]"
          />
          アーカイブも表示
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
              onClick={() => handleCreateTasks(selectedEntries)}
              className="border border-indigo-400 text-indigo-600 rounded-md px-3 py-1 text-sm font-medium hover:bg-indigo-50"
            >
              📋 タスク作成
            </button>
            <button
              onClick={() => handleBulkArchive(selectedEntries)}
              className="border border-red-400 text-red-600 rounded-md px-3 py-1 text-sm font-medium hover:bg-red-50"
            >
              🗑 アーカイブ
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
          onJobDbUrlEdit={openUrlEditModal}
          onEntryRouteEdit={(entry) => setRouteModalEntry(entry)}
          onRowClick={(id) => setDetailEntryId(id)}
          selectedIds={selectedIds}
          onSelectToggle={(id) => setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
          onSelectAll={(ids) => setSelectedIds(new Set(ids))}
          onDeselectAll={() => setSelectedIds(new Set())}
          isAdmin={isAdmin}
          onUnarchive={handleUnarchive}
          onHardDelete={handleHardDelete}
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

      {/* URL Edit Modal */}
      {urlModalEntryId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
          onClick={() => { if (!savingUrl) setUrlModalEntryId(null); }}>
          <div className="bg-white rounded-lg p-5 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-700 mb-3">求人DBのURLを{urlInput ? "編集" : "登録"}</h3>
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveJobDbUrl(); }}
              placeholder="求人DBのURLを貼り付け"
              autoFocus
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setUrlModalEntryId(null)}
                disabled={savingUrl}
                className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              >キャンセル</button>
              <button
                onClick={saveJobDbUrl}
                disabled={savingUrl}
                className="bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >{savingUrl ? "保存中..." : "保存"}</button>
            </div>
          </div>
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

      {/* Entry Route Switch Modal */}
      {routeModalEntry && (
        <EntryRouteSwitchModal
          entry={routeModalEntry}
          onClose={() => setRouteModalEntry(null)}
          onSaved={(updated) => {
            setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
            setRouteModalEntry(null);
          }}
        />
      )}
    </div>
  );
}
