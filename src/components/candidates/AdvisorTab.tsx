"use client";

import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";

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

export default function AdvisorTab({
  candidateId,
  candidateName,
}: {
  candidateId: string;
  candidateName: string;
}) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
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

  const fetchMessages = async (sessionId: string) => {
    const res = await fetch(
      `/api/candidates/${candidateId}/advisor/sessions/${sessionId}/messages`
    );
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages || []);
    }
  };

  // セッション自動作成・自動選択
  useEffect(() => {
    const initSession = async () => {
      setIsInitializing(true);
      try {
        const res = await fetch(`/api/candidates/${candidateId}/advisor/sessions`);
        const data = await res.json();
        const sessions = data.sessions || [];

        if (sessions.length > 0) {
          setActiveSessionId(sessions[0].id);
          await fetchMessages(sessions[0].id);
        } else {
          const createRes = await fetch(`/api/candidates/${candidateId}/advisor/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: `${candidateName}さんのアドバイザーチャット` }),
          });
          if (createRes.ok) {
            const newSession = await createRes.json();
            setActiveSessionId(newSession.session.id);
          }
        }
      } catch {
        // silent
      } finally {
        setIsInitializing(false);
      }
    };
    initSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  const handleClearHistory = async () => {
    if (!activeSessionId) return;
    if (!confirm("チャット履歴をすべて削除します。よろしいですか？")) return;

    try {
      await fetch(`/api/candidates/${candidateId}/advisor/sessions/${activeSessionId}`, {
        method: "DELETE",
      });
      const createRes = await fetch(`/api/candidates/${candidateId}/advisor/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `${candidateName}さんのアドバイザーチャット` }),
      });
      if (createRes.ok) {
        const newSession = await createRes.json();
        setActiveSessionId(newSession.session.id);
        setMessages([]);
      }
    } catch {
      alert("履歴のクリアに失敗しました");
    }
  };

  const handleSend = async () => {
    const userMessage = inputValue.trim();
    const currentFile = attachedFile;

    if (!userMessage && !currentFile) return;
    if (!activeSessionId || isSending) return;

    setInputValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setIsSending(true);

    let fileData: { name: string; mimeType: string; base64: string; size: number } | null = null;
    if (currentFile) {
      try {
        const arrayBuffer = await currentFile.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        let binaryString = "";
        for (let i = 0; i < uint8Array.length; i++) {
          binaryString += String.fromCharCode(uint8Array[i]);
        }
        fileData = {
          name: currentFile.name,
          mimeType: currentFile.type,
          base64: btoa(binaryString),
          size: currentFile.size,
        };
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 150000);

    try {
      const res = await fetch(
        `/api/candidates/${candidateId}/advisor/sessions/${activeSessionId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: displayContent, file: fileData }),
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "エラーが発生しました");

      setAttachedFile(null);
      await fetchMessages(activeSessionId);
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError") {
        await fetchMessages(activeSessionId);
      } else {
        setMessages((prev) => prev.filter((m) => !m.id?.startsWith("temp-ai-")));
        alert(err instanceof Error ? err.message : "エラーが発生しました");
      }
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

  if (isInitializing) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-gray-400">読み込み中...</p>
      </div>
    );
  }

  return (
    <div
      ref={chatAreaRef}
      className="flex flex-col h-full rounded-lg border border-gray-200 overflow-hidden bg-white relative"
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

      {/* ヘッダー */}
      <div className="bg-[#F4F7F9] px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <div>
            <span className="font-bold text-[#003366] text-sm">AIアドバイザー</span>
            <p className="text-xs text-gray-500">{candidateName} さんの情報を踏まえてアドバイスします</p>
          </div>
        </div>
        <button
          onClick={handleClearHistory}
          className="text-gray-400 hover:text-red-500 text-sm cursor-pointer transition-colors"
        >
          🗑 履歴をクリア
        </button>
      </div>

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
                <div className="text-sm leading-relaxed">
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                      h2: ({ children }) => <p className="font-bold text-base mt-4 mb-2">{children}</p>,
                      h3: ({ children }) => <p className="font-bold mt-3 mb-1">{children}</p>,
                      ul: ({ children }) => <ul className="ml-4 mb-3 space-y-1">{children}</ul>,
                      ol: ({ children }) => <ol className="ml-4 mb-3 space-y-1 list-decimal">{children}</ol>,
                      li: ({ children }) => <li className="text-sm">{children}</li>,
                      strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                      code: ({ children }) => <code className="bg-gray-200 rounded px-1 py-0.5 text-xs">{children}</code>,
                      hr: () => <hr className="my-3 border-gray-300" />,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
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
            <button onClick={() => setAttachedFile(null)} className="text-gray-400 hover:text-red-500 text-sm shrink-0 ml-2">✕</button>
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
            onChange={(e) => { const f = e.target.files?.[0]; if (f) validateAndSetFile(f); e.target.value = ""; }}
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
    </div>
  );
}
