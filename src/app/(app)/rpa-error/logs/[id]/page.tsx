"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import RpaErrorNav from "@/components/rpa-error/RpaErrorNav";

type Note = { id: string; content: string; createdAt: string; user: { name: string } };
type ChatMessage = { id: string; role: string; content: string; createdAt: string };
type ErrorLogDetail = {
  id: string;
  machineNumber: number;
  flowName: string;
  errorSummary: string;
  status: string;
  severity: string | null;
  occurredAt: string;
  createdAt: string;
  registeredUser: { name: string };
  knownError: { patternName: string; solution: string; solutionUrl: string | null; severity: string } | null;
  notes: Note[];
  chat: { messages: ChatMessage[] } | null;
};

export default function RpaErrorLogDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [log, setLog] = useState<ErrorLogDetail | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [posting, setPosting] = useState(false);

  const loadLog = useCallback(async () => {
    const res = await fetch(`/api/rpa-error/logs/${id}`);
    if (res.ok) {
      const data = await res.json();
      setLog(data.log);
    }
  }, [id]);

  useEffect(() => { loadLog(); }, [loadLog]);

  const postNote = async () => {
    if (!noteContent.trim() || posting) return;
    setPosting(true);
    await fetch(`/api/rpa-error/logs/${id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: noteContent }),
    });
    setNoteContent("");
    setPosting(false);
    loadLog();
  };

  const updateStatus = async (status: string) => {
    await fetch(`/api/rpa-error/logs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    loadLog();
  };

  if (!log) return <div className="py-12 text-center text-[#9CA3AF]">読み込み中...</div>;

  return (
    <div className="max-w-4xl">
      <RpaErrorNav />
      <a href="/rpa-error/logs" className="text-[13px] text-[#2563EB] hover:underline">&larr; エラー一覧に戻る</a>

      {/* エラー情報 */}
      <div className="mt-4 rounded-lg border border-[#E5E7EB] bg-white p-6">
        <div className="flex items-start justify-between">
          <h1 className="text-[18px] font-bold text-[#374151]">{log.machineNumber}号機 - {log.flowName}</h1>
          <select
            value={log.status}
            onChange={(e) => updateStatus(e.target.value)}
            className={`rounded-full border px-3 py-1 text-[13px] ${
              log.status === "未対応" ? "border-[#DC2626]/30 bg-[#DC2626]/10 text-[#DC2626]"
              : log.status === "対応中" ? "border-[#D97706]/30 bg-[#D97706]/10 text-[#D97706]"
              : "border-[#16A34A]/30 bg-[#16A34A]/10 text-[#16A34A]"
            }`}
          >
            <option value="未対応">未対応</option>
            <option value="対応中">対応中</option>
            <option value="解決済み">解決済み</option>
          </select>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-[14px]">
          <div><span className="text-[#6B7280]">深刻度:</span> <span className={log.severity === "緊急" ? "text-[#DC2626] font-semibold" : log.severity === "要対応" ? "text-[#D97706]" : "text-[#9CA3AF]"}>{log.severity || "未分類"}</span></div>
          <div><span className="text-[#6B7280]">発生日時:</span> {new Date(log.occurredAt).toLocaleString("ja-JP")}</div>
          <div><span className="text-[#6B7280]">登録者:</span> {log.registeredUser.name}</div>
          <div><span className="text-[#6B7280]">登録日:</span> {new Date(log.createdAt).toLocaleString("ja-JP")}</div>
        </div>

        <div className="mt-4">
          <span className="text-[13px] font-medium text-[#6B7280]">エラー概要</span>
          <p className="mt-1 text-[14px] text-[#374151] whitespace-pre-wrap bg-[#F9FAFB] rounded p-3">{log.errorSummary}</p>
        </div>
      </div>

      {/* 既知エラー情報 */}
      {log.knownError && (
        <div className="mt-4 rounded-lg border border-[#2563EB]/20 bg-[#EFF6FF] p-5">
          <h3 className="text-[14px] font-semibold text-[#2563EB]">既知エラーパターン: {log.knownError.patternName}</h3>
          <p className="mt-2 text-[14px] text-[#374151] whitespace-pre-wrap">{log.knownError.solution}</p>
          {log.knownError.solutionUrl && (
            <a href={log.knownError.solutionUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[14px] text-[#2563EB] underline">
              対応手順URL
            </a>
          )}
        </div>
      )}

      {/* チャット履歴 */}
      {log.chat && log.chat.messages.length > 0 && (
        <div className="mt-4 rounded-lg border border-[#E5E7EB] bg-white p-5">
          <h3 className="text-[15px] font-semibold text-[#374151] mb-3">チャット履歴</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {log.chat.messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-lg px-3 py-2 text-[13px] whitespace-pre-wrap ${m.role === "user" ? "bg-[#2563EB] text-white" : "bg-[#F3F4F6] text-[#374151]"}`}>
                  {m.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 対応メモ */}
      <div className="mt-4 rounded-lg border border-[#E5E7EB] bg-white p-5">
        <h3 className="text-[15px] font-semibold text-[#374151] mb-3">対応メモ</h3>
        {log.notes.length > 0 ? (
          <div className="space-y-3 mb-4">
            {log.notes.map((n) => (
              <div key={n.id} className="border-l-2 border-[#2563EB] pl-3">
                <div className="text-[12px] text-[#9CA3AF]">{n.user.name} - {new Date(n.createdAt).toLocaleString("ja-JP")}</div>
                <p className="text-[14px] text-[#374151] whitespace-pre-wrap">{n.content}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-[#9CA3AF] mb-4">まだメモがありません</p>
        )}

        <div className="flex gap-2">
          <textarea
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            placeholder="対応メモを追記..."
            rows={2}
            className="flex-1 rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] resize-none focus:border-[#2563EB] focus:outline-none"
          />
          <button
            onClick={postNote}
            disabled={!noteContent.trim() || posting}
            className="self-end rounded-md bg-[#2563EB] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            投稿
          </button>
        </div>
      </div>
    </div>
  );
}
