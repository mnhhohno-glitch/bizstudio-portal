"use client";

// T-085: 日報コメント欄。自分の日報でも他人の日報でも投稿・閲覧できる。
// 削除は投稿者本人または admin のみ。AIチャット(DailyReportChat)とは別物。

import { useState, useEffect, useCallback } from "react";

type Comment = {
  id: string;
  body: string;
  userId: string;
  userName: string;
  createdAt: string;
};

function fmtTs(iso: string): string {
  const d = new Date(iso);
  // JST 表示（罠 #17：toISOString は使わず toLocale 系）
  const date = d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
  const time = d.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

export default function DailyReportComments({
  targetUserId,
  date,
  currentUserId,
  isAdmin,
}: {
  targetUserId: string;
  date: string;
  currentUserId: string;
  isAdmin: boolean;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [input, setInput] = useState("");
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchComments = useCallback(async () => {
    if (!targetUserId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/daily-report/comments?userId=${targetUserId}&date=${date}`);
      if (res.ok) setComments((await res.json()).comments ?? []);
    } catch { /* */ } finally { setLoading(false); }
  }, [targetUserId, date]);

  useEffect(() => { void fetchComments(); }, [fetchComments]);

  const handlePost = async () => {
    const text = input.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const res = await fetch("/api/daily-report/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: targetUserId, date, body: text }),
      });
      if (res.ok) {
        const d = await res.json();
        setComments(d.comments ?? []);
        setInput("");
      } else {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "コメントの投稿に失敗しました");
      }
    } catch { alert("コメントの投稿に失敗しました"); } finally { setPosting(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("このコメントを削除しますか？")) return;
    try {
      const res = await fetch(`/api/daily-report/comments?id=${id}`, { method: "DELETE" });
      if (res.ok) setComments((await res.json()).comments ?? []);
      else { const e = await res.json().catch(() => ({})); alert(e.error || "削除に失敗しました"); }
    } catch { alert("削除に失敗しました"); }
  };

  return (
    <div className="border-t border-[#E5E7EB] p-4">
      <div className="text-[13px] font-medium text-[#374151] mb-2">💬 コメント{comments.length > 0 ? `（${comments.length}）` : ""}</div>

      <div className="space-y-2 mb-3">
        {loading && comments.length === 0 ? (
          <div className="text-[12px] text-[#9CA3AF]">読み込み中...</div>
        ) : comments.length === 0 ? (
          <div className="text-[12px] text-[#9CA3AF]">まだコメントはありません。</div>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[12px] font-medium text-[#374151]">{c.userName || "（不明）"}</span>
                <span className="text-[11px] text-[#9CA3AF]">{fmtTs(c.createdAt)}</span>
                {(c.userId === currentUserId || isAdmin) && (
                  <button onClick={() => handleDelete(c.id)} className="ml-auto text-[11px] text-[#9CA3AF] hover:text-red-500">削除</button>
                )}
              </div>
              <div className="text-[13px] text-[#374151] whitespace-pre-wrap leading-relaxed">{c.body}</div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-start gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={6}
          placeholder="コメントを入力（上司・同僚もコメントできます）"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-[13px] resize-y focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handlePost(); }}
        />
        <button
          onClick={handlePost}
          disabled={posting || !input.trim()}
          className="bg-[#2563EB] text-white rounded-lg px-4 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50 shrink-0"
        >
          {posting ? "投稿中..." : "投稿"}
        </button>
      </div>
    </div>
  );
}
