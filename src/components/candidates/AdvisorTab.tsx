"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";

type Session = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
};

type Message = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  isLoading?: boolean;
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${formatTime(iso)}`;
}

export default function AdvisorTab({
  candidateId,
  candidateName,
}: {
  candidateId: string;
  candidateName: string;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatAreaRef = useRef<HTMLDivElement>(null);

  const validateAndSetFile = (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      alert("ファイルサイズは20MB以下にしてください");
      return;
    }
    setAttachedFile(file);
  };

  const fetchSessions = useCallback(async () => {
    const res = await fetch(`/api/candidates/${candidateId}/advisor/sessions`);
    if (res.ok) {
      const data = await res.json();
      setSessions(data.sessions || []);
    }
  }, [candidateId]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const fetchMessages = async (sessionId: string) => {
    const res = await fetch(
      `/api/candidates/${candidateId}/advisor/sessions/${sessionId}/messages`
    );
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages || []);
    }
  };

  const selectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    fetchMessages(sessionId);
  };

  const createSession = async () => {
    const res = await fetch(`/api/candidates/${candidateId}/advisor/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const data = await res.json();
      setActiveSessionId(data.session.id);
      setMessages([]);
      fetchSessions();
    }
  };

  const deleteSession = async (sessionId: string) => {
    if (!confirm("このチャットを削除しますか？")) return;
    await fetch(`/api/candidates/${candidateId}/advisor/sessions/${sessionId}`, {
      method: "DELETE",
    });
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      setMessages([]);
    }
    fetchSessions();
  };

  const handleSend = async () => {
    const userMessage = inputValue.trim();
    const currentFile = attachedFile;

    if (!userMessage && !currentFile) return;
    if (!activeSessionId || isSending) return;

    setInputValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setIsSending(true);

    // ファイルがあればBase64エンコード
    let fileData: { name: string; mimeType: string; base64: string; size: number } | null = null;
    if (currentFile) {
      try {
        const arrayBuffer = await currentFile.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        let binaryString = "";
        for (let i = 0; i < uint8Array.length; i++) {
          binaryString += String.fromCharCode(uint8Array[i]);
        }
        const base64 = btoa(binaryString);
        fileData = {
          name: currentFile.name,
          mimeType: currentFile.type,
          base64,
          size: currentFile.size,
        };
        console.log("File encoded:", currentFile.name, "size:", base64.length);
      } catch (err) {
        console.error("File encode error:", err);
      }
    }

    const displayContent = userMessage || `添付ファイル: ${currentFile?.name}`;

    setMessages((prev) => [
      ...prev,
      {
        id: "temp-user-" + Date.now(),
        role: "user",
        content: displayContent + (currentFile ? `\n\n---\n添付ファイル「${currentFile.name}」` : ""),
        createdAt: new Date().toISOString(),
      },
      {
        id: "temp-ai-" + Date.now(),
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        isLoading: true,
      },
    ]);

    try {
      console.log("Sending to API:", { content: displayContent, hasFile: !!fileData });

      const res = await fetch(
        `/api/candidates/${candidateId}/advisor/sessions/${activeSessionId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: displayContent,
            file: fileData,
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "エラーが発生しました");

      setAttachedFile(null);
      await fetchMessages(activeSessionId);
      fetchSessions();
    } catch (err) {
      setMessages((prev) => prev.filter((m) => !m.id?.startsWith("temp-ai-")));
      alert(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex h-full rounded-lg border border-gray-200 overflow-hidden bg-white">
      {/* 左パネル: セッション一覧 */}
      <div className="w-64 shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200">
          <button
            onClick={createSession}
            className="w-full bg-[#003366] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#002244] transition-colors"
          >
            + 新しいチャット
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`relative px-4 py-3 cursor-pointer border-b border-gray-100 hover:bg-white transition-colors ${
                activeSessionId === s.id ? "bg-white border-l-2 border-l-[#2563EB]" : ""
              }`}
              onClick={() => selectSession(s.id)}
              onMouseEnter={() => setHoveredSession(s.id)}
              onMouseLeave={() => setHoveredSession(null)}
            >
              <p className="text-sm font-medium text-gray-800 truncate pr-6">{s.title}</p>
              <p className="text-xs text-gray-400 mt-1">
                {formatDate(s.updatedAt)} ・ {s._count.messages}件
              </p>
              {hoveredSession === s.id && (
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                  className="absolute top-3 right-3 text-gray-300 hover:text-red-500 text-xs"
                >
                  🗑
                </button>
              )}
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="px-4 py-6 text-xs text-gray-400 text-center">チャット履歴はありません</p>
          )}
        </div>
      </div>

      {/* 右パネル: チャットエリア */}
      <div
        ref={chatAreaRef}
        className="flex-1 flex flex-col min-w-0 relative"
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!chatAreaRef.current?.contains(e.relatedTarget as Node)) setIsDragging(false); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) validateAndSetFile(f); }}
      >
        {isDragging && (
          <div className="absolute inset-0 bg-[#2563EB]/10 border-2 border-dashed border-[#2563EB] rounded-xl flex items-center justify-center z-10">
            <p className="text-[#2563EB] font-bold text-lg">📎 ファイルをドロップして添付</p>
          </div>
        )}
        {!activeSessionId ? (
          /* セッション未選択 */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center py-16">
              <div className="text-4xl mb-3">🤖</div>
              <h3 className="text-lg font-semibold text-gray-700">AIアドバイザー</h3>
              <p className="text-sm text-gray-400 mt-2">
                {candidateName} さんの情報を<br />踏まえてアドバイスします。
              </p>
              <p className="text-xs text-gray-400 mt-4">
                左のメニューからチャットを選択するか、<br />新しいチャットを始めてください。
              </p>
              <button
                onClick={createSession}
                className="mt-6 bg-[#003366] text-white rounded-lg px-6 py-2.5 text-sm font-medium hover:bg-[#002244] transition-colors"
              >
                + 新しいチャットを始める
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* メッセージ表示 */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {messages.length === 0 && (
                <div className="text-center py-12 text-sm text-gray-400">
                  メッセージを入力してAIアドバイザーに相談してください
                </div>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start gap-3"}`}>
                  {msg.role === "assistant" && (
                    <div className="w-8 h-8 bg-[#F4F7F9] rounded-full flex items-center justify-center text-sm shrink-0">
                      🤖
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] px-4 py-3 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-[#003366] text-white rounded-2xl rounded-br-sm"
                        : "bg-[#F4F7F9] text-gray-800 rounded-2xl rounded-bl-sm"
                    }`}
                  >
                    {msg.isLoading ? (
                      <div className="flex gap-1 py-1">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    ) : msg.role === "assistant" ? (
                      <div className="prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (() => {
                      const attachMatch = msg.content.match(/添付ファイル「(.+?)」の内容:/);
                      const attachName = attachMatch ? attachMatch[1] : null;
                      const displayText = msg.content.replace(/\n\n---\n添付ファイル「.+?」の内容:[\s\S]*$/, "").trim();
                      return (
                        <>
                          {attachName && (
                            <div className="text-xs bg-white/20 rounded px-2 py-1 mb-1 inline-block">📎 {attachName}</div>
                          )}
                          <span className="whitespace-pre-wrap">{displayText || `📎 ${attachName}`}</span>
                        </>
                      );
                    })()}
                    <p className={`text-xs mt-1 ${msg.role === "user" ? "text-white/60 text-right" : "text-gray-400"}`}>
                      {!msg.isLoading && formatTime(msg.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* 入力エリア */}
            <div className="border-t border-gray-200 bg-white">
              {/* 添付ファイルプレビュー */}
              {attachedFile && (
                <div className="mx-4 mt-2 bg-[#F4F7F9] rounded-lg px-3 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm">📎</span>
                    <span className="text-sm text-gray-700 truncate">{attachedFile.name}</span>
                    <span className="text-xs text-gray-400 shrink-0">
                      {attachedFile.size < 1024 * 1024
                        ? `${(attachedFile.size / 1024).toFixed(1)}KB`
                        : `${(attachedFile.size / (1024 * 1024)).toFixed(1)}MB`}
                    </span>
                  </div>
                  <button onClick={() => setAttachedFile(null)} className="text-gray-400 hover:text-red-500 text-sm shrink-0 ml-2">
                    ✕
                  </button>
                </div>
              )}
              <div className="px-4 py-3 flex items-end gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSending}
                  className="w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-xl text-gray-600 hover:text-[#2563EB] transition-colors flex-shrink-0 disabled:opacity-50"
                >
                  ＋
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.txt,.csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) validateAndSetFile(f);
                    e.target.value = "";
                  }}
                />
                <textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    const el = e.target;
                    el.style.height = "auto";
                    el.style.height = Math.min(el.scrollHeight, 120) + "px";
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="メッセージを入力..."
                  rows={1}
                  className="flex-1 resize-none border border-gray-300 rounded-xl px-4 py-3 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                  style={{ maxHeight: "120px" }}
                />
                <button
                  onClick={handleSend}
                  disabled={(!inputValue.trim() && !attachedFile) || isSending}
                  className={`bg-[#2563EB] text-white rounded-xl px-4 py-3 font-medium hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${isSending ? "animate-pulse" : ""}`}
                >
                  {isSending ? "⏳" : "送信"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
