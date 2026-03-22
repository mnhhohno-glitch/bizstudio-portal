"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type Message = { id: string; role: string; content: string; createdAt: string };
type ChatSession = { id: string; createdAt: string; messages: Message[]; errorLog?: { id: string } | null };

export default function RpaErrorChatPage() {
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saveModal, setSaveModal] = useState<{
    machineNumber: number;
    flowName: string;
    errorSummary: string;
    severity: string | null;
    knownErrorId: string | null;
    occurredAt: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadChats = useCallback(async () => {
    const res = await fetch("/api/rpa-error/chat");
    if (res.ok) {
      const data = await res.json();
      setChats(data.chats);
    }
  }, []);

  useEffect(() => { loadChats(); }, [loadChats]);

  const loadChat = async (chatId: string) => {
    setActiveChatId(chatId);
    const res = await fetch(`/api/rpa-error/chat/${chatId}`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.chat.messages);
    }
  };

  const startNewChat = async () => {
    const res = await fetch("/api/rpa-error/chat", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setActiveChatId(data.chatId);
      setMessages([]);
      loadChats();
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !activeChatId || sending) return;
    const userMsg = input.trim();
    setInput("");
    setSending(true);
    setMessages((prev) => [...prev, { id: "temp", role: "user", content: userMsg, createdAt: new Date().toISOString() }]);

    try {
      const res = await fetch(`/api/rpa-error/chat/${activeChatId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: userMsg }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev.filter((m) => m.id !== "temp"),
          { id: "user-" + Date.now(), role: "user", content: userMsg, createdAt: new Date().toISOString() },
          { ...data.message, createdAt: new Date().toISOString() },
        ]);
      }
    } catch {
      // restore
    } finally {
      setSending(false);
      loadChats();
    }
  };

  const handleExtract = async () => {
    if (!activeChatId) return;
    setExtracting(true);
    try {
      const res = await fetch(`/api/rpa-error/chat/${activeChatId}/extract`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setSaveModal({
          machineNumber: data.machineNumber || 1,
          flowName: data.flowName || "00.スカウトメール送信",
          errorSummary: data.errorSummary || "",
          severity: data.severity || null,
          knownErrorId: data.knownErrorId || null,
          occurredAt: new Date().toISOString().slice(0, 16),
        });
      }
    } catch { /* */ }
    finally { setExtracting(false); }
  };

  const handleSaveLog = async () => {
    if (!saveModal || !activeChatId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/rpa-error/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...saveModal, chatId: activeChatId }),
      });
      if (res.ok) {
        setSaveModal(null);
        loadChats();
      }
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const formatContent = (content: string) => {
    // URLをリンクに変換
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = content.split(urlRegex);
    return parts.map((part, i) =>
      urlRegex.test(part) ? (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-[#2563EB] underline break-all">{part}</a>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  };

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-4">
      {/* 左: チャット一覧 */}
      <div className="w-64 shrink-0 rounded-lg border border-[#E5E7EB] bg-white flex flex-col">
        <div className="p-3 border-b border-[#E5E7EB]">
          <button onClick={startNewChat} className="w-full rounded-md bg-[#2563EB] px-3 py-2 text-[13px] font-medium text-white hover:bg-[#1D4ED8]">
            + 新規チャット
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {chats.map((c) => (
            <button
              key={c.id}
              onClick={() => loadChat(c.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-[#F3F4F6] text-[13px] hover:bg-[#F9FAFB] ${activeChatId === c.id ? "bg-[#EEF2FF]" : ""}`}
            >
              <div className="truncate text-[#374151]">
                {c.messages[0]?.content.slice(0, 30) || "新規チャット"}
              </div>
              <div className="text-[11px] text-[#9CA3AF] mt-0.5">
                {new Date(c.createdAt).toLocaleDateString("ja-JP")}
                {c.errorLog && <span className="ml-1 text-[#16A34A]">保存済</span>}
              </div>
            </button>
          ))}
        </div>
        {/* サブメニュー */}
        <div className="border-t border-[#E5E7EB] p-2 space-y-1">
          <a href="/rpa-error/logs" className="block px-3 py-1.5 text-[12px] text-[#6B7280] hover:text-[#374151] hover:bg-[#F3F4F6] rounded">
            エラー一覧
          </a>
          <a href="/rpa-error/known-errors" className="block px-3 py-1.5 text-[12px] text-[#6B7280] hover:text-[#374151] hover:bg-[#F3F4F6] rounded">
            既知エラー管理
          </a>
          <a href="/rpa-error/stats" className="block px-3 py-1.5 text-[12px] text-[#6B7280] hover:text-[#374151] hover:bg-[#F3F4F6] rounded">
            統計
          </a>
        </div>
      </div>

      {/* 右: チャットエリア */}
      <div className="flex-1 rounded-lg border border-[#E5E7EB] bg-white flex flex-col">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB]">
          <h2 className="text-[15px] font-semibold text-[#374151]">RPAエラー相談</h2>
          {activeChatId && messages.length > 0 && (
            <button
              onClick={handleExtract}
              disabled={extracting}
              className="rounded-md bg-[#16A34A] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#15803D] disabled:opacity-50"
            >
              {extracting ? "抽出中..." : "エラーログに保存"}
            </button>
          )}
        </div>

        {/* メッセージ */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!activeChatId && (
            <div className="flex items-center justify-center h-full text-[14px] text-[#9CA3AF]">
              左の「新規チャット」からエラー相談を開始してください
            </div>
          )}
          {messages.map((m, i) => (
            <div key={m.id || i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-lg px-4 py-2.5 text-[14px] whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-[#2563EB] text-white"
                  : "bg-[#F3F4F6] text-[#374151]"
              }`}>
                {formatContent(m.content)}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-[#F3F4F6] rounded-lg px-4 py-2.5 text-[14px] text-[#9CA3AF]">
                考え中...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 入力エリア */}
        {activeChatId && (
          <div className="border-t border-[#E5E7EB] p-3">
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="エラー内容を貼り付けてください..."
                rows={2}
                className="flex-1 resize-none rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || sending}
                className="self-end rounded-md bg-[#2563EB] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                送信
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 保存モーダル */}
      {saveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-[16px] font-semibold text-[#374151] mb-4">エラーログに保存</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">号機</label>
                <select
                  value={saveModal.machineNumber}
                  onChange={(e) => setSaveModal({ ...saveModal, machineNumber: parseInt(e.target.value), flowName: parseInt(e.target.value) <= 6 ? "00.スカウトメール送信" : "01.応募者一次返信・情報取り込み" })}
                  className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]"
                >
                  {[1,2,3,4,5,6,7].map((n) => <option key={n} value={n}>{n}号機</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">フロー名</label>
                <input value={saveModal.flowName} onChange={(e) => setSaveModal({ ...saveModal, flowName: e.target.value })} className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">エラー概要</label>
                <textarea value={saveModal.errorSummary} onChange={(e) => setSaveModal({ ...saveModal, errorSummary: e.target.value })} rows={3} className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-[13px] font-medium text-[#374151] mb-1">深刻度</label>
                  <select value={saveModal.severity || ""} onChange={(e) => setSaveModal({ ...saveModal, severity: e.target.value || null })} className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]">
                    <option value="">未分類</option>
                    <option value="放置OK">放置OK</option>
                    <option value="要対応">要対応</option>
                    <option value="緊急">緊急</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-[13px] font-medium text-[#374151] mb-1">発生日時</label>
                  <input type="datetime-local" value={saveModal.occurredAt} onChange={(e) => setSaveModal({ ...saveModal, occurredAt: e.target.value })} className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]" />
                </div>
              </div>
            </div>
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setSaveModal(null)} className="rounded-md bg-[#F3F4F6] px-4 py-2 text-[14px] font-medium text-[#374151] hover:bg-[#E5E7EB]">キャンセル</button>
              <button onClick={handleSaveLog} disabled={saving || !saveModal.errorSummary} className="rounded-md bg-[#2563EB] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50">
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
