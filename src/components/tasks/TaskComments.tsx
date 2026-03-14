"use client";

import { useState, useEffect, useCallback } from "react";

type Comment = {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  user: { id: string; name: string };
};

type Props = {
  taskId: string;
  currentUserId: string;
  currentUserRole: string;
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}日前`;
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TaskComments({ taskId, currentUserId, currentUserRole }: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newContent, setNewContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [error, setError] = useState("");
  const [editError, setEditError] = useState("");

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const handleSubmit = async () => {
    const trimmed = newContent.trim();
    if (!trimmed || submitting) return;

    if (trimmed.length > 2000) {
      setError("コメントは2000文字以内で入力してください");
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "コメントの投稿に失敗しました");
        return;
      }
      setNewContent("");
      await fetchComments();
    } catch {
      setError("コメントの投稿に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (comment: Comment) => {
    setEditingId(comment.id);
    setEditContent(comment.content);
    setEditError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent("");
    setEditError("");
  };

  const saveEdit = async (commentId: string) => {
    const trimmed = editContent.trim();
    if (!trimmed) {
      setEditError("コメント内容を入力してください");
      return;
    }
    if (trimmed.length > 2000) {
      setEditError("コメントは2000文字以内で入力してください");
      return;
    }

    setEditError("");
    setEditSaving(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments/${commentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json();
        setEditError(data.error || "コメントの更新に失敗しました");
        return;
      }
      setEditingId(null);
      setEditContent("");
      await fetchComments();
    } catch {
      setEditError("コメントの更新に失敗しました");
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm("このコメントを削除しますか？")) return;

    try {
      const res = await fetch(`/api/tasks/${taskId}/comments/${commentId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "コメントの削除に失敗しました");
        return;
      }
      await fetchComments();
    } catch {
      alert("コメントの削除に失敗しました");
    }
  };

  const isEdited = (c: Comment) => {
    return new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime() > 1000;
  };

  const canDelete = (c: Comment) => c.user.id === currentUserId || currentUserRole === "admin";
  const canEdit = (c: Comment) => c.user.id === currentUserId;

  return (
    <div className="mt-6 border-t border-[#F3F4F6] pt-4">
      <h2 className="mb-3 text-[14px] font-bold text-[#374151]">
        コメント
        {comments.length > 0 && (
          <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#EEF2FF] px-1.5 text-[11px] font-medium text-[#2563EB]">
            {comments.length}
          </span>
        )}
      </h2>

      {/* コメント一覧 */}
      {loading ? (
        <p className="text-[13px] text-[#9CA3AF]">読み込み中...</p>
      ) : comments.length === 0 ? (
        <p className="text-[13px] text-[#9CA3AF]">コメントはまだありません</p>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => (
            <div key={c.id} className="group relative rounded-[6px] border border-[#E5E7EB] bg-[#F9FAFB] p-3">
              {/* header row */}
              <div className="mb-1 flex items-center gap-2">
                {/* avatar */}
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2563EB] text-[11px] font-medium text-white">
                  {c.user.name.charAt(0)}
                </span>
                <span className="text-[13px] font-medium text-[#374151]">{c.user.name}</span>
                <span className="text-[11px] text-[#9CA3AF]">{formatRelativeTime(c.createdAt)}</span>
                {isEdited(c) && (
                  <span className="text-[11px] text-[#9CA3AF]">(編集済み)</span>
                )}

                {/* action buttons */}
                {(canEdit(c) || canDelete(c)) && editingId !== c.id && (
                  <div className="ml-auto flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {canEdit(c) && (
                      <button
                        type="button"
                        onClick={() => startEdit(c)}
                        className="rounded p-1 text-[#9CA3AF] hover:bg-[#E5E7EB] hover:text-[#374151]"
                        title="編集"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    )}
                    {canDelete(c) && (
                      <button
                        type="button"
                        onClick={() => handleDelete(c.id)}
                        className="rounded p-1 text-[#9CA3AF] hover:bg-red-50 hover:text-red-500"
                        title="削除"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* body — edit mode or display */}
              {editingId === c.id ? (
                <div className="mt-2">
                  <textarea
                    className="w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[13px] text-[#374151] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                    rows={3}
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                  />
                  {editError && (
                    <p className="mt-1 text-[12px] text-red-500">{editError}</p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={editSaving || !editContent.trim()}
                      onClick={() => saveEdit(c.id)}
                      className="rounded-[6px] bg-[#2563EB] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-50"
                    >
                      {editSaving ? "保存中..." : "保存"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={editSaving}
                      className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 text-[12px] font-medium text-[#374151] transition-colors hover:bg-[#F3F4F6]"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-[13px] text-[#374151]">{c.content}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 投稿フォーム */}
      <div className="mt-4">
        <textarea
          className="w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[13px] text-[#374151] placeholder-[#9CA3AF] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
          rows={3}
          placeholder="コメントを入力..."
          value={newContent}
          onChange={(e) => {
            setNewContent(e.target.value);
            if (error) setError("");
          }}
        />
        {error && (
          <p className="mt-1 text-[12px] text-red-500">{error}</p>
        )}
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            disabled={!newContent.trim() || submitting}
            onClick={handleSubmit}
            className="rounded-[6px] bg-[#2563EB] px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {submitting ? "送信中..." : "コメントを送信"}
          </button>
        </div>
      </div>
    </div>
  );
}
