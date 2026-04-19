"use client";

import { useState, useEffect, useCallback } from "react";
import { toast, Toaster } from "sonner";
import InterviewForm from "@/components/candidates/InterviewForm";

type InterviewRecord = {
  id: string;
  interviewDate: string;
  interviewCount: number;
  status: string;
  isLatest: boolean;
  lastSavedAt: string | null;
  startTime: string | null;
  endTime: string | null;
  interviewTool: string | null;
  interviewType: string | null;
  interviewer: { name: string } | null;
  rating: { overallRank: string | null; grandTotal: number | null } | null;
  _count: { memos: number; attachments: number };
};

type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function StatusDot({ status, lastSavedAt }: { status: string; lastSavedAt: string | null }) {
  if (status === "complete") {
    return <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" title="完了" />;
  }
  if (lastSavedAt) {
    return <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400" title="下書き(保存あり)" />;
  }
  return <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" title="未入力" />;
}

export default function InterviewHistoryTab({
  candidateId,
  currentUser,
}: {
  candidateId: string;
  currentUser: SessionUser | null;
}) {
  const [interviews, setInterviews] = useState<InterviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [currentEmployeeId, setCurrentEmployeeId] = useState<string | null>(null);

  const fetchInterviews = useCallback(async () => {
    try {
      const res = await fetch(`/api/candidates/${candidateId}/interviews`);
      if (res.ok) {
        const data = await res.json();
        const records = (data.records || []) as InterviewRecord[];
        records.sort((a, b) => a.interviewCount - b.interviewCount);
        setInterviews(records);
        if (!selectedId && records.length > 0) {
          const latest = records.find((r) => r.isLatest) || records[records.length - 1];
          setSelectedId(latest.id);
        }
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [candidateId, selectedId]);

  useEffect(() => {
    fetchInterviews();
  }, [fetchInterviews]);

  useEffect(() => {
    if (!currentUser) return;
    console.log("[DEBUG-EMP-1] Fetching employees for userId:", currentUser.id);
    fetch("/api/employees")
      .then((r) => r.json())
      .then((data: { id: string; userId: string | null }[]) => {
        console.log("[DEBUG-EMP-2] employees response:", Array.isArray(data) ? `${data.length} items` : typeof data, data);
        if (!Array.isArray(data)) return;
        const match = data.find((e) => e.userId === currentUser.id);
        console.log("[DEBUG-EMP-3] match:", match);
        if (match) setCurrentEmployeeId(match.id);
      })
      .catch((err) => {
        console.error("[DEBUG-EMP-4] employees fetch error:", err);
      });
  }, [currentUser]);

  const handleCreateInterview = async () => {
    console.log("[DEBUG-1] handleCreateInterview called", { creating, currentUser: currentUser?.id, currentEmployeeId });
    if (creating || !currentUser || !currentEmployeeId) {
      console.log("[DEBUG-2] EARLY RETURN", { creating, hasUser: !!currentUser, currentEmployeeId });
      return;
    }
    setCreating(true);
    try {
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      console.log("[DEBUG-3] POST /api/interviews", { candidateId, currentEmployeeId, timeStr });
      const res = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          interviewDate: now.toISOString(),
          startTime: timeStr,
          endTime: timeStr,
          interviewTool: "電話",
          interviewerUserId: currentEmployeeId,
          interviewType: interviews.length === 0 ? "初回面談" : "フォロー面談",
          status: "draft",
        }),
      });
      console.log("[DEBUG-4] API response status:", res.status);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("[DEBUG-5] API error:", err);
        throw new Error(err.error || "作成に失敗しました");
      }
      const data = await res.json();
      console.log("[DEBUG-6] API response data:", data);
      toast.success("新規面談を作成しました");
      setSelectedId(data.record.id);
      console.log("[DEBUG-7] setSelectedId:", data.record.id);
      await fetchInterviews();
      console.log("[DEBUG-8] fetchInterviews complete");
    } catch (e) {
      console.error("[DEBUG-9] catch:", e);
      toast.error(e instanceof Error ? e.message : "新規面談の作成に失敗しました");
    } finally {
      setCreating(false);
    }
  };

  const visibleInterviews = interviews.slice(0, 5);
  const overflowInterviews = interviews.slice(5);
  const selectedInterview = interviews.find((i) => i.id === selectedId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-6 w-6 border-3 border-[#2563EB] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div>
      <Toaster position="bottom-center" richColors />

      {/* Interview list bar */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium text-gray-500 mr-1">面談:</span>

          {visibleInterviews.map((iv) => (
            <button
              key={iv.id}
              onClick={() => setSelectedId(iv.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors ${
                selectedId === iv.id
                  ? "bg-blue-50 border-blue-300 text-blue-700"
                  : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              <StatusDot status={iv.status} lastSavedAt={iv.lastSavedAt} />
              <span>{iv.interviewCount}回目</span>
              <span className="text-gray-400">{formatShortDate(iv.interviewDate)}</span>
            </button>
          ))}

          {overflowInterviews.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <span>すべて({interviews.length})</span>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {dropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
                  <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 min-w-[200px] max-h-60 overflow-y-auto">
                    {interviews.map((iv) => (
                      <button
                        key={iv.id}
                        onClick={() => {
                          setSelectedId(iv.id);
                          setDropdownOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-[12px] text-left hover:bg-gray-50 ${
                          selectedId === iv.id ? "bg-blue-50 text-blue-700" : "text-gray-600"
                        }`}
                      >
                        <StatusDot status={iv.status} lastSavedAt={iv.lastSavedAt} />
                        <span className="font-medium">{iv.interviewCount}回目</span>
                        <span className="text-gray-400">{formatShortDate(iv.interviewDate)}</span>
                        {iv.interviewer && (
                          <span className="text-gray-400 ml-auto">{iv.interviewer.name}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <button
            onClick={handleCreateInterview}
            disabled={creating}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-medium border-2 border-dashed border-gray-300 text-gray-500 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
          >
            {creating ? "作成中..." : "+ 新規面談"}
          </button>

          {selectedInterview && (
            <div className="ml-auto flex items-center gap-1 text-[11px] text-gray-400">
              <span>{selectedInterview.interviewType || ""}</span>
              <span className="text-gray-300">|</span>
              <span>{selectedInterview.interviewer?.name || ""}</span>
            </div>
          )}
        </div>
      </div>

      {/* Interview form area */}
      {selectedInterview ? (
        <InterviewForm
          interviewId={selectedInterview.id}
          candidateId={candidateId}
          currentUser={currentUser}
          onSaved={() => fetchInterviews()}
        />
      ) : (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-12 flex items-center justify-center min-h-[300px]">
          <div className="text-center text-gray-400">
            <p className="text-lg mb-2">面談がありません</p>
            <p className="text-sm mb-4">「+ 新規面談」ボタンで最初の面談を作成してください</p>
            <button
              onClick={handleCreateInterview}
              disabled={creating}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-md text-[13px] font-medium bg-[#2563EB] text-white hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
            >
              {creating ? "作成中..." : "+ 新規面談を作成"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
