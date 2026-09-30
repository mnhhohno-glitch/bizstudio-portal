"use client";

import { useState, useEffect, useCallback } from "react";
import { toast, Toaster } from "sonner";
import InterviewForm from "@/components/candidates/InterviewForm";
// T-207: 空状態にも「案内メール」を出す（T-208 step4 で「面談準備」ボタンは外した。入口は「面談スクリプト」タブ）
import CandidateContactMailButton from "@/components/candidates/CandidateContactMailButton";
// T-208 step4: 新規面談の作成は面談スクリプトタブと同じ処理（interview-create.ts）
import {
  createInterviewRecord,
  defaultSelectedInterview,
  fetchInterviewList,
  formatShortDate,
  InterviewCreateError,
  useCurrentEmployeeId,
  type InterviewListRecord,
} from "@/components/candidates/interview-create";

type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

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
  initialSelectedId,
  onRegisterFlush,
}: {
  candidateId: string;
  currentUser: SessionUser | null;
  /** T-208 step4: 面談スクリプトタブの「面談履歴で確かめる」から来たとき、最初に選ぶ面談記録（?interview=） */
  initialSelectedId?: string | null;
  /** T-208 step4: タブを離れる前に未保存の入力を保存する関数を親（CandidateDetailPage）に登録する */
  onRegisterFlush?: (fn: (() => Promise<void>) | null) => void;
}) {
  const [interviews, setInterviews] = useState<InterviewListRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [creating, setCreating] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const currentEmployeeId = useCurrentEmployeeId(currentUser);

  const fetchInterviews = useCallback(async () => {
    try {
      const records = await fetchInterviewList(candidateId);
      setInterviews(records);
      if (records.length > 0) {
        setSelectedId((prev) => (prev && records.some((r) => r.id === prev) ? prev : defaultSelectedInterview(records)?.id ?? null));
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    fetchInterviews();
  }, [fetchInterviews]);

  const handleCreateInterview = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const newId = await createInterviewRecord({ candidateId, currentUser, currentEmployeeId, existingCount: interviews.length });
      toast.success("新規面談を作成しました");
      setSelectedId(newId);
      await fetchInterviews();
    } catch (e) {
      toast.error(e instanceof InterviewCreateError ? e.message : "新規面談の作成に失敗しました");
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
      <div className="bg-white rounded-lg border border-gray-200 p-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium text-gray-500 mr-1">面談:</span>

          {visibleInterviews.map((iv, idx) => (
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
              <span>{idx + 1}回目</span>
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
                    {interviews.map((iv, idx) => (
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
                        <span className="font-medium">{idx + 1}回目</span>
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
          interviewSeq={interviews.findIndex((i) => i.id === selectedInterview.id) + 1}
          onSaved={() => fetchInterviews()}
          onDeleted={() => { setSelectedId(null); fetchInterviews(); }}
          onRegisterFlush={onRegisterFlush}
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
            {/* T-207: 面談記録が無くても案内メールは送れる（面談準備は「面談スクリプト」タブから） */}
            <CandidateContactMailButton candidateId={candidateId} appearance="empty" />
          </div>
        </div>
      )}
    </div>
  );
}
