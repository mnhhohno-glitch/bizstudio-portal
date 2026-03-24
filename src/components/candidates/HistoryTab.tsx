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

function areaMatchColor(value: string | null): string {
  if (!value) return "text-gray-500";
  if (value === "該当") return "text-green-600 font-medium";
  if (value === "近隣") return "text-blue-600 font-medium";
  if (value === "非該当") return "text-red-600 font-medium";
  return "text-gray-700";
}

/* ---------- Sub-components ---------- */

function SkeletonCards() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-gray-200 p-4 animate-pulse">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-4 w-4 bg-gray-200 rounded" />
            <div className="h-4 w-10 bg-gray-200 rounded" />
            <div className="h-4 w-32 bg-gray-200 rounded" />
            <div className="ml-auto h-4 w-24 bg-gray-200 rounded" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="h-4 w-full bg-gray-200 rounded" />
            <div className="h-4 w-3/4 bg-gray-200 rounded" />
            <div className="h-4 w-1/2 bg-gray-200 rounded" />
            <div className="h-4 w-2/3 bg-gray-200 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function JobCardFields({
  label1,
  value1,
  label2,
  value2,
  value1Class,
  value2Class,
}: {
  label1: string;
  value1: string | null;
  label2: string;
  value2: string | null;
  value1Class?: string;
  value2Class?: string;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
      <div>
        <span className="text-xs text-gray-400">{label1}</span>
        <p className={`text-sm ${value1Class || "text-gray-700"} whitespace-pre-wrap`}>
          {value1 || "—"}
        </p>
      </div>
      <div>
        <span className="text-xs text-gray-400">{label2}</span>
        <p className={`text-sm ${value2Class || "text-gray-700"} whitespace-pre-wrap`}>
          {value2 || "—"}
        </p>
      </div>
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

  // Entries state
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
  const jobs = jobsData?.jobs || [];
  const totalJobs = jobsData?.total_jobs ?? 0;

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
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-[#374151]">
              抽出結果（{totalJobs}件）
            </h3>
            <button
              onClick={() => setShowEntryModal(true)}
              disabled={selectedJobIds.size === 0 || submitting}
              className="bg-[#2563EB] text-white rounded-md px-3 py-1.5 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
          ) : jobs.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-gray-400">
              この求職者の求人紹介データはまだありません
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map((job, idx) => {
                const isEntered = enteredJobIds.has(job.id);
                const isSelected = selectedJobIds.has(job.id);

                return (
                  <div
                    key={job.id}
                    className={`rounded-lg border p-4 transition-shadow ${
                      isSelected
                        ? "border-[#2563EB] bg-blue-50/30"
                        : "border-gray-200 hover:shadow-sm"
                    }`}
                  >
                    {/* カードヘッダー */}
                    <div className="flex items-center gap-3 mb-3 flex-wrap">
                      {isEntered ? (
                        <span className="text-xs text-gray-400 bg-gray-100 rounded px-2 py-0.5">
                          エントリー済み
                        </span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleJobSelection(job.id)}
                          className="w-4 h-4 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
                        />
                      )}
                      <span className="text-xs text-gray-400">#{idx + 1}</span>
                      <span className="font-semibold text-sm text-[#374151]">
                        {job.company_name}
                      </span>
                      {job.job_category && (
                        <span className="text-xs bg-blue-100 text-blue-700 rounded px-2 py-0.5">
                          {job.job_category}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-gray-400">
                        {[job.job_db, job.job_type].filter(Boolean).join(" / ")}
                      </span>
                    </div>

                    {/* カード詳細 */}
                    <div className="space-y-2 ml-7">
                      <JobCardFields
                        label1="求人タイトル"
                        value1={job.job_title}
                        label2="勤務地"
                        value2={job.work_location}
                      />
                      <JobCardFields
                        label1="年収"
                        value1={job.salary}
                        label2="残業"
                        value2={job.overtime}
                      />
                      <JobCardFields
                        label1="エリア判定"
                        value1={job.area_match}
                        label2="転勤"
                        value2={job.transfer}
                        value1Class={areaMatchColor(job.area_match)}
                      />
                      <div className="pt-1">
                        <span className="text-xs text-gray-400">
                          紹介日: {formatDateJST(job.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===== エントリーサブタブ ===== */}
      {activeSubTab === "entries" && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          {/* ヘッダー */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-[#374151]">
              エントリー一覧（{entries.length}件）
            </h3>
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
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow"
                >
                  {/* カードヘッダー */}
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <span className="font-semibold text-sm text-[#374151]">
                      {entry.companyName}
                    </span>
                    {entry.jobCategory && (
                      <span className="text-xs bg-blue-100 text-blue-700 rounded px-2 py-0.5">
                        {entry.jobCategory}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-gray-400">
                      {[entry.jobDb, entry.jobType].filter(Boolean).join(" / ")}
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

                  {/* カード詳細 */}
                  <div className="space-y-2">
                    <JobCardFields
                      label1="求人タイトル"
                      value1={entry.jobTitle}
                      label2="勤務地"
                      value2={entry.workLocation}
                    />
                    <JobCardFields
                      label1="年収"
                      value1={entry.salary}
                      label2="残業"
                      value2={entry.overtime}
                    />
                    <JobCardFields
                      label1="エリア判定"
                      value1={entry.areaMatch}
                      label2="転勤"
                      value2={entry.transfer}
                      value1Class={areaMatchColor(entry.areaMatch)}
                    />
                    <div className="flex items-center gap-4 pt-1 flex-wrap">
                      <span className="text-xs text-gray-400">
                        紹介日: {formatDateJST(entry.introducedAt)}
                      </span>
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
                    </div>
                  </div>
                </div>
              ))}
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
