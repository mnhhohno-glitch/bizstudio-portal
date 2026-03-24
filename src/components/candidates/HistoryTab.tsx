"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

/* ---------- Types ---------- */
type Job = {
  id: number;
  company_name: string;
  job_title: string;
  job_db: string | null;
  job_type: string | null;
  job_category: string | null;
  work_location: string | null;
  salary: string | null;
  overtime: string | null;
  area_match: string | null;
  transfer: string | null;
  original_url: string | null;
  created_at: string;
  updated_at: string;
};

type JobsResponse = {
  jobs: Job[];
  total_jobs: number;
  project_id?: number;
  project_name?: string;
  job_seeker_id?: string;
  job_seeker_name?: string;
};

type Entry = {
  id: string;
  candidateId: string;
  externalJobId: number;
  companyName: string;
  jobTitle: string;
  jobDb: string | null;
  jobType: string | null;
  jobCategory: string | null;
  workLocation: string | null;
  salary: string | null;
  overtime: string | null;
  areaMatch: string | null;
  transfer: string | null;
  originalUrl: string | null;
  entryDate: string;
  introducedAt: string;
  createdAt: string;
  updatedAt: string;
};

/* ---------- Helpers ---------- */
function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase();
}

function formatDateJST(iso: string): string {
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function toInputDate(iso: string): string {
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function todayString(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/* ---------- Sub-components ---------- */

function SkeletonCards() {
  return (
    <div className="grid grid-cols-1 gap-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="rounded-lg border border-gray-200 p-3 animate-pulse">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-4 w-4 bg-gray-200 rounded" />
            <div className="h-4 w-28 bg-gray-200 rounded" />
            <div className="ml-auto h-4 w-20 bg-gray-200 rounded" />
          </div>
          <div className="h-4 w-full bg-gray-200 rounded mb-2" />
          <div className="h-3 w-24 bg-gray-200 rounded" />
        </div>
      ))}
    </div>
  );
}

/* ---------- Entry Date Modal ---------- */
function EntryDateModal({
  count,
  onConfirm,
  onCancel,
}: {
  count: number;
  onConfirm: (date: string) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(todayString());

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl max-w-md w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[15px] font-bold text-[#374151]">
            エントリー日を選択
          </h2>
          <button
            onClick={onCancel}
            className="text-[#6B7280] hover:text-[#374151] text-xl leading-none"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          {count}件の求人をエントリーします
        </p>

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm mb-6 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
        />

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={() => onConfirm(date)}
            disabled={!date}
            className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
          >
            登録
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Main Component                                                      */
/* ================================================================== */
export default function HistoryTab({ candidateId }: { candidateId: string }) {
  const [activeSubTab, setActiveSubTab] = useState<"jobs" | "entries">("jobs");

  // Jobs state
  const [jobsData, setJobsData] = useState<JobsResponse | null>(null);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<number>>(new Set());
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [jobSearch, setJobSearch] = useState("");

  // Entries state
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [entrySearch, setEntrySearch] = useState("");

  // Derive entered external job ids for cross-referencing
  const enteredJobIds = new Set(entries.map((e) => e.externalJobId));

  /* ---------- Fetch ---------- */
  const fetchJobs = useCallback(async () => {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/jobs`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `エラー (${res.status})`);
      }
      const data: JobsResponse = await res.json();
      setJobsData(data);
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : "データの取得に失敗しました");
    } finally {
      setJobsLoading(false);
    }
  }, [candidateId]);

  const fetchEntries = useCallback(async () => {
    setEntriesLoading(true);
    setEntriesError(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/entries`);
      if (!res.ok) throw new Error("エントリーの取得に失敗しました");
      const data = await res.json();
      setEntries(data.entries || []);
    } catch (err) {
      setEntriesError(err instanceof Error ? err.message : "データの取得に失敗しました");
    } finally {
      setEntriesLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    fetchJobs();
    fetchEntries();
  }, [fetchJobs, fetchEntries]);

  /* ---------- Handlers ---------- */
  const toggleJobSelection = (jobId: number) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const selectableJobIds = (jobsData?.jobs || [])
    .filter((j) => !enteredJobIds.has(j.id))
    .map((j) => j.id);

  const allSelectableChecked =
    selectableJobIds.length > 0 &&
    selectableJobIds.every((id) => selectedJobIds.has(id));

  const handleToggleAll = () => {
    if (allSelectableChecked) {
      setSelectedJobIds(new Set());
    } else {
      setSelectedJobIds(new Set(selectableJobIds));
    }
  };

  const handleEntrySubmit = async (entryDate: string) => {
    if (!jobsData) return;
    setSubmitting(true);

    const selectedJobs = jobsData.jobs.filter((j) => selectedJobIds.has(j.id));
    const payload = {
      entries: selectedJobs.map((j) => ({
        externalJobId: j.id,
        companyName: j.company_name,
        jobTitle: j.job_title,
        jobDb: j.job_db,
        jobType: j.job_type,
        jobCategory: j.job_category,
        workLocation: j.work_location,
        salary: j.salary,
        overtime: j.overtime,
        areaMatch: j.area_match,
        transfer: j.transfer,
        originalUrl: j.original_url,
        introducedAt: j.created_at,
      })),
      entryDate,
    };

    try {
      const res = await fetch(`/api/candidates/${candidateId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("エントリーの登録に失敗しました");
      const data = await res.json();

      if (data.skipped > 0) {
        toast.success(`${data.created}件登録、${data.skipped}件は登録済みのためスキップ`);
      } else {
        toast.success(`${data.created}件のエントリーを登録しました`);
      }

      setSelectedJobIds(new Set());
      setShowEntryModal(false);
      fetchEntries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm("このエントリーを削除します。よろしいですか？")) return;
    setDeletingId(entryId);
    try {
      const res = await fetch(
        `/api/candidates/${candidateId}/entries/${entryId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("削除に失敗しました");
      toast.success("エントリーを削除しました");
      fetchEntries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setDeletingId(null);
    }
  };

  const handleUpdateEntryDate = async (entryId: string, newDate: string) => {
    try {
      const res = await fetch(
        `/api/candidates/${candidateId}/entries/${entryId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryDate: newDate }),
        }
      );
      if (!res.ok) throw new Error("更新に失敗しました");
      toast.success("エントリー日を更新しました");
      setEditingEntryId(null);
      fetchEntries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新に失敗しました");
    }
  };

  /* ---------- Render ---------- */
  const allJobs = jobsData?.jobs || [];
  const totalJobs = jobsData?.total_jobs ?? 0;
  const jobs = jobSearch
    ? allJobs.filter((j) => normalize(j.company_name).includes(normalize(jobSearch)))
    : allJobs;
  const filteredEntries = entrySearch
    ? entries.filter((e) => normalize(e.companyName).includes(normalize(entrySearch)))
    : entries;

  return (
    <div>
      {/* サブタブバー */}
      <div className="bg-gray-50 rounded-lg p-1 inline-flex gap-1 mb-6">
        <button
          onClick={() => setActiveSubTab("jobs")}
          className={`px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
            activeSubTab === "jobs"
              ? "bg-white text-[#2563EB] shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          求人紹介
          {totalJobs > 0 && (
            <span className="ml-1.5 text-xs text-gray-400">({totalJobs})</span>
          )}
        </button>
        <button
          onClick={() => setActiveSubTab("entries")}
          className={`px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
            activeSubTab === "entries"
              ? "bg-white text-[#2563EB] shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          エントリー
          {entries.length > 0 && (
            <span className="ml-1.5 text-xs text-gray-400">({entries.length})</span>
          )}
        </button>
      </div>

      {/* ===== 求人紹介サブタブ ===== */}
      {activeSubTab === "jobs" && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          {/* ヘッダー */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <h3 className="text-[14px] font-semibold text-[#374151] shrink-0">
              抽出結果（{jobSearch ? `${jobs.length}件 / ${totalJobs}件` : `${totalJobs}件`}）
            </h3>
            <div className="relative">
              <input
                type="text"
                value={jobSearch}
                onChange={(e) => setJobSearch(e.target.value)}
                placeholder="🔍 会社名で検索..."
                className="border border-gray-300 rounded-md pl-3 pr-7 py-1 text-[13px] w-48 focus:outline-none focus:ring-1 focus:ring-[#2563EB] focus:border-[#2563EB]"
              />
              {jobSearch && (
                <button
                  onClick={() => setJobSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>
            {selectableJobIds.length > 0 && (
              <button
                onClick={handleToggleAll}
                className="text-[13px] text-gray-500 hover:text-[#2563EB] transition-colors"
              >
                {allSelectableChecked ? "☑ 全解除" : "☐ 全選択"}
              </button>
            )}
            <button
              onClick={() => setShowEntryModal(true)}
              disabled={selectedJobIds.size === 0 || submitting}
              className="ml-auto bg-[#2563EB] text-white rounded-md px-3 py-1.5 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ☑ 選択してエントリー
              {selectedJobIds.size > 0 && ` (${selectedJobIds.size})`}
            </button>
          </div>

          {/* コンテンツ */}
          {jobsLoading ? (
            <SkeletonCards />
          ) : jobsError ? (
            <div className="py-8 text-center text-[13px] text-red-500">{jobsError}</div>
          ) : allJobs.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-gray-400">
              この求職者の求人紹介データはまだありません
            </div>
          ) : jobs.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-gray-400">
              該当する求人が見つかりません
            </div>
          ) : (
            <div
              className="overflow-y-auto"
              style={{ maxHeight: "calc(100vh - 400px)" }}
            >
              <div className="grid grid-cols-1 gap-3">
                {jobs.map((job) => {
                  const isEntered = enteredJobIds.has(job.id);
                  const isSelected = selectedJobIds.has(job.id);

                  return (
                    <div
                      key={job.id}
                      className={`rounded-lg border p-3 transition-shadow ${
                        isSelected
                          ? "border-[#2563EB] bg-blue-50/30"
                          : "border-gray-200 hover:shadow-sm"
                      }`}
                    >
                      {/* 1行目: チェック + 会社名 + バッジ + DB/タイプ */}
                      <div className="flex items-center gap-2 min-w-0">
                        {isEntered ? (
                          <span className="shrink-0 text-xs text-gray-400 bg-gray-100 rounded px-2 py-0.5">
                            済
                          </span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleJobSelection(job.id)}
                            className="shrink-0 w-4 h-4 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
                          />
                        )}
                        <span className="font-semibold text-sm text-[#374151] truncate">
                          {job.company_name}
                        </span>
                        {job.job_category && (
                          <span className="shrink-0 text-xs bg-blue-100 text-blue-700 rounded px-2 py-0.5">
                            {job.job_category}
                          </span>
                        )}
                        <span className="shrink-0 ml-auto text-xs text-gray-400">
                          {[job.job_db, job.job_type].filter(Boolean).join(" / ")}
                        </span>
                      </div>
                      {/* 2行目: 求人タイトル + 紹介日 */}
                      <div className="flex items-start justify-between gap-3 mt-1 ml-6">
                        <p className="text-sm text-gray-700 line-clamp-2 min-w-0">
                          {job.job_title}
                        </p>
                        <span className="shrink-0 text-xs text-gray-400 pt-0.5">
                          紹介日: {formatDateJST(job.created_at)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== エントリーサブタブ ===== */}
      {activeSubTab === "entries" && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          {/* ヘッダー */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <h3 className="text-[14px] font-semibold text-[#374151] shrink-0">
              エントリー一覧（{entrySearch ? `${filteredEntries.length}件 / ${entries.length}件` : `${entries.length}件`}）
            </h3>
            <div className="relative">
              <input
                type="text"
                value={entrySearch}
                onChange={(e) => setEntrySearch(e.target.value)}
                placeholder="🔍 会社名で検索..."
                className="border border-gray-300 rounded-md pl-3 pr-7 py-1 text-[13px] w-48 focus:outline-none focus:ring-1 focus:ring-[#2563EB] focus:border-[#2563EB]"
              />
              {entrySearch && (
                <button
                  onClick={() => setEntrySearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* コンテンツ */}
          {entriesLoading ? (
            <SkeletonCards />
          ) : entriesError ? (
            <div className="py-8 text-center text-[13px] text-red-500">{entriesError}</div>
          ) : entries.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-gray-400">
              エントリーはまだありません。求人紹介タブから求人を選択してエントリーできます。
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-gray-400">
              該当するエントリーが見つかりません
            </div>
          ) : (
            <div
              className="overflow-y-auto"
              style={{ maxHeight: "calc(100vh - 400px)" }}
            >
              <div className="grid grid-cols-1 gap-3">
                {filteredEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-gray-200 p-3 hover:shadow-sm transition-shadow"
                  >
                    {/* 1行目: 会社名 + バッジ + DB/タイプ */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-sm text-[#374151] truncate">
                        {entry.companyName}
                      </span>
                      {entry.jobCategory && (
                        <span className="shrink-0 text-xs bg-blue-100 text-blue-700 rounded px-2 py-0.5">
                          {entry.jobCategory}
                        </span>
                      )}
                      <span className="shrink-0 ml-auto text-xs text-gray-400">
                        {[entry.jobDb, entry.jobType].filter(Boolean).join(" / ")}
                      </span>
                    </div>
                    {/* 2行目: 求人タイトル + エントリー日/紹介日 + 削除 */}
                    <div className="flex items-start justify-between gap-3 mt-1">
                      <p className="text-sm text-gray-700 line-clamp-2 min-w-0">
                        {entry.jobTitle}
                      </p>
                      <div className="shrink-0 flex items-center gap-2 pt-0.5">
                        <span className="text-xs font-medium text-[#374151]">
                          エントリー日:{" "}
                          {editingEntryId === entry.id ? (
                            <input
                              type="date"
                              value={editingDate}
                              onChange={(e) => setEditingDate(e.target.value)}
                              onBlur={() => {
                                if (editingDate && editingDate !== toInputDate(entry.entryDate)) {
                                  handleUpdateEntryDate(entry.id, editingDate);
                                } else {
                                  setEditingEntryId(null);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && editingDate) {
                                  handleUpdateEntryDate(entry.id, editingDate);
                                } else if (e.key === "Escape") {
                                  setEditingEntryId(null);
                                }
                              }}
                              autoFocus
                              className="border border-gray-300 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                            />
                          ) : (
                            <button
                              onClick={() => {
                                setEditingEntryId(entry.id);
                                setEditingDate(toInputDate(entry.entryDate));
                              }}
                              className="hover:text-[#2563EB] hover:underline transition-colors"
                            >
                              {formatDateJST(entry.entryDate)}
                            </button>
                          )}
                        </span>
                        <span className="text-xs text-gray-400">
                          (紹介日: {formatDateJST(entry.introducedAt)})
                        </span>
                        <button
                          onClick={() => handleDeleteEntry(entry.id)}
                          disabled={deletingId === entry.id}
                          className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                          title="削除"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* エントリー日選択モーダル */}
      {showEntryModal && (
        <EntryDateModal
          count={selectedJobIds.size}
          onConfirm={handleEntrySubmit}
          onCancel={() => setShowEntryModal(false)}
        />
      )}
    </div>
  );
}
