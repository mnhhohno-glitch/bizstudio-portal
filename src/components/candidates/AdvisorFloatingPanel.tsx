"use client";

import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

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

function isGreetingMessage(content: string): { isGreeting: boolean; label: string; body: string } {
  const match = content.match(/^(【(?:LINE|メール)向け挨拶文】)\n\n([\s\S]*)$/);
  if (match) {
    return { isGreeting: true, label: match[1], body: match[2] };
  }
  return { isGreeting: false, label: "", body: content };
}

interface AdvisorFloatingPanelProps {
  candidateId: string;
  candidateName: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function AdvisorFloatingPanel({
  candidateId,
  candidateName,
  isOpen,
  onClose,
}: AdvisorFloatingPanelProps) {
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

  const [showGreetingOptions, setShowGreetingOptions] = useState(false);
  const [isGeneratingGreeting, setIsGeneratingGreeting] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<string | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);

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

  const handleGenerateGreeting = async (format: "line" | "email") => {
    if (!activeSessionId || isGeneratingGreeting) return;
    setIsGeneratingGreeting(true);
    setShowGreetingOptions(false);

    setMessages((prev) => [
      ...prev,
      {
        id: "temp-greeting-" + Date.now(),
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        isLoading: true,
      },
    ]);

    try {
      const res = await fetch(`/api/candidates/${candidateId}/advisor/greeting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, sessionId: activeSessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "挨拶文の生成に失敗しました");

      await fetchMessages(activeSessionId);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => !m.id?.startsWith("temp-greeting-")));
      alert(err instanceof Error ? err.message : "挨拶文の生成に失敗しました");
    } finally {
      setIsGeneratingGreeting(false);
    }
  };

  const handleCopyGreeting = async (messageId: string, body: string) => {
    try {
      await navigator.clipboard.writeText(body);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch {
      // fallback
    }
  };

  const handleFullAnalysis = async () => {
    if (!activeSessionId || isAnalyzing) return;
    setIsAnalyzing(true);

    try {
      // Get bookmark file count (with extracted text)
      const filesRes = await fetch(`/api/candidates/${candidateId}/files?category=BOOKMARK`);
      const filesData = await filesRes.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const totalFiles = filesData.files?.filter((f: any) => f.extractedAt).length || 0;

      if (totalFiles === 0) {
        toast.error("テキスト化済みのブックマークがありません");
        setIsAnalyzing(false);
        return;
      }

      const batchSize = 5;
      const totalBatches = Math.ceil(totalFiles / batchSize);

      for (let i = 0; i < totalBatches; i++) {
        setAnalysisProgress(`分析中... (${i + 1}/${totalBatches}バッチ)`);

        try {
          const res = await fetch(`/api/candidates/${candidateId}/bookmarks/analyze-batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: activeSessionId,
              batchIndex: i,
              batchSize,
              totalFiles,
              isLastBatch: i === totalBatches - 1,
            }),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => null);
            throw new Error(err?.error || `バッチ${i + 1}の分析に失敗しました`);
          }

          // Refresh messages to show new results
          await fetchMessages(activeSessionId);

          // Wait between batches (rate limit)
          if (i < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        } catch (error) {
          console.error(`[FullAnalysis] Batch ${i + 1} failed:`, error);
          toast.error(`バッチ${i + 1}の分析に失敗しました`);
          break;
        }
      }

      toast.success(`全${totalFiles}件の分析が完了しました`);
      window.dispatchEvent(new Event("bookmark-ratings-updated"));
    } catch (error) {
      console.error("[FullAnalysis] Error:", error);
      toast.error("分析の開始に失敗しました");
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(null);
    }
  };

  const handleAdditionalAnalysis = async () => {
    if (!activeSessionId || isAnalyzing) return;

    // Find the latest analysis message to determine sinceDate
    const lastAnalysis = [...messages]
      .filter((m) => m.role === "assistant" && m.content.includes("【求人分析"))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!lastAnalysis) {
      toast.error("まず全件分析を実行してください");
      return;
    }

    const sinceDate = lastAnalysis.createdAt;

    // Check how many new files exist since last analysis
    const filesRes = await fetch(`/api/candidates/${candidateId}/files?category=BOOKMARK`);
    const filesData = await filesRes.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newFiles = filesData.files?.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (f: any) => f.extractedAt && new Date(f.createdAt) > new Date(sinceDate)
    ) || [];

    if (newFiles.length === 0) {
      toast.info("前回の分析以降に追加されたブックマークはありません");
      return;
    }

    setIsAnalyzing(true);
    const totalFiles = newFiles.length;
    const batchSize = 5;
    const totalBatches = Math.ceil(totalFiles / batchSize);

    try {
      for (let i = 0; i < totalBatches; i++) {
        setAnalysisProgress(`追加分析中... (${i + 1}/${totalBatches}バッチ)`);

        try {
          const res = await fetch(`/api/candidates/${candidateId}/bookmarks/analyze-batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: activeSessionId,
              batchIndex: i,
              batchSize,
              totalFiles,
              isLastBatch: i === totalBatches - 1,
              sinceDate,
            }),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => null);
            throw new Error(err?.error || `追加分析バッチ${i + 1}に失敗しました`);
          }

          await fetchMessages(activeSessionId);

          if (i < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        } catch (error) {
          console.error(`[AdditionalAnalysis] Batch ${i + 1} failed:`, error);
          toast.error(`追加分析バッチ${i + 1}に失敗しました`);
          break;
        }
      }

      toast.success(`追加${totalFiles}件の分析が完了しました`);
      window.dispatchEvent(new Event("bookmark-ratings-updated"));
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(null);
    }
  };

  const handleTypeDiagnosis = async () => {
    if (isDiagnosing || !activeSessionId || isSending || isAnalyzing) return;
    setIsDiagnosing(true);

    const diagnosisMessage = `この求職者のタイプ診断と検索戦略を分析してください。

以下の項目を全て出力してください：
1. 6タイプ志向性診断（主タイプ・副タイプ、根拠付き）
2. Will-Can-Must分析
3. 検索条件（職種キーワード、業種S→A→B優先度、年収レンジ、エリア、フリーワード）
4. 避けるべき求人の特徴
5. 提案時の注意点（応募を躊躇しそうなポイント、書類通過率の見込み）
6. 書類作成のポイント（職務経歴書で強調すべき点）`;

    setMessages((prev) => [
      ...prev,
      {
        id: `temp-user-${Date.now()}`,
        role: "user",
        content: "🔍 タイプ診断を実行",
        createdAt: new Date().toISOString(),
      },
      {
        id: `temp-loading-${Date.now()}`,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        isLoading: true,
      },
    ]);

    try {
      const res = await fetch(
        `/api/candidates/${candidateId}/advisor/sessions/${activeSessionId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: diagnosisMessage }),
        }
      );
      if (!res.ok) throw new Error("タイプ診断の実行に失敗しました");
      await fetchMessages(activeSessionId);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => !m.isLoading));
      alert(err instanceof Error ? err.message : "タイプ診断の実行に失敗しました");
    } finally {
      setIsDiagnosing(false);
    }
  };

  const hasAnalysisHistory = messages.some(
    (m) => m.role === "assistant" && m.content.includes("【求人分析")
  );

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

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full z-50 bg-white shadow-2xl border-l border-gray-200 transition-transform duration-300 ease-in-out w-full lg:w-[50vw] lg:min-w-[480px] lg:max-w-[800px] ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div
          ref={chatAreaRef}
          className="flex flex-col h-full overflow-hidden relative"
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!chatAreaRef.current?.contains(e.relatedTarget as Node)) setIsDragging(false); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) validateAndSetFile(f); }}
        >
          {isDragging && (
            <div className="absolute inset-0 bg-[#2563EB]/10 border-2 border-dashed border-[#2563EB] flex items-center justify-center z-10">
              <p className="text-[#2563EB] font-bold text-lg">ファイルをドロップして添付</p>
            </div>
          )}

          {/* Header */}
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xl">🤖</span>
              <div>
                <h3 className="font-semibold text-sm">AIアドバイザー</h3>
                <p className="text-xs text-gray-500">{candidateName} さんの情報を踏まえてアドバイスします</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleClearHistory}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                🗑 履歴クリア
              </button>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-1"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Action buttons */}
          <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-3 shrink-0 flex-wrap">
            <button
              onClick={() => setShowGreetingOptions(!showGreetingOptions)}
              disabled={!activeSessionId || isGeneratingGreeting || isAnalyzing}
              className="bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md px-3 py-1.5 text-[13px] font-medium text-[#2563EB] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              ✉ 挨拶文生成
            </button>
            {showGreetingOptions && !isGeneratingGreeting && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer text-[13px] text-gray-700">
                  <input
                    type="radio"
                    name="greetingFormatPanel"
                    className="accent-[#2563EB]"
                    onChange={() => handleGenerateGreeting("line")}
                  />
                  LINE
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-[13px] text-gray-700">
                  <input
                    type="radio"
                    name="greetingFormatPanel"
                    className="accent-[#2563EB]"
                    onChange={() => handleGenerateGreeting("email")}
                  />
                  メール
                </label>
              </div>
            )}
            {isGeneratingGreeting && (
              <span className="text-[13px] text-gray-400 animate-pulse">挨拶文を生成中...</span>
            )}
            <button
              onClick={handleTypeDiagnosis}
              disabled={!activeSessionId || isDiagnosing || isSending || isAnalyzing || isGeneratingGreeting}
              className="bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md px-3 py-1.5 text-[13px] font-medium text-[#2563EB] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isDiagnosing ? (
                <span className="flex items-center gap-1">
                  <span className="animate-spin text-sm">⏳</span>
                  分析中...
                </span>
              ) : (
                "🔍 タイプ診断"
              )}
            </button>
            <div className="ml-auto flex items-center gap-2">
              {isAnalyzing ? (
                <div className="flex items-center gap-2 text-blue-600">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span className="text-[13px] font-semibold animate-pulse">{analysisProgress || "分析中..."}</span>
                </div>
              ) : (
                <>
                  <button
                    onClick={handleFullAnalysis}
                    disabled={!activeSessionId || isGeneratingGreeting}
                    className="bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md px-3 py-1.5 text-[13px] font-medium text-[#2563EB] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    📊 全件分析
                  </button>
                  {hasAnalysisHistory && (
                    <button
                      onClick={handleAdditionalAnalysis}
                      disabled={!activeSessionId || isGeneratingGreeting}
                      className="bg-green-50 hover:bg-green-100 border border-green-200 rounded-md px-3 py-1.5 text-[13px] font-medium text-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      📊 追加のみ
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {isInitializing ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-gray-400">読み込み中...</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-12 text-sm text-gray-400">
                メッセージを入力してAIアドバイザーに相談してください
              </div>
            ) : (
              messages.map((msg) => {
                const greeting = msg.role === "assistant" ? isGreetingMessage(msg.content) : null;

                return (
                  <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start gap-3"}`}>
                    {msg.role === "assistant" && (
                      <div className="w-8 h-8 bg-[#F4F7F9] rounded-full flex items-center justify-center text-sm shrink-0">
                        🤖
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] px-4 py-3 text-sm leading-relaxed relative ${
                        msg.role === "user"
                          ? "bg-[#003366] text-white rounded-2xl rounded-br-sm"
                          : "bg-[#F4F7F9] text-gray-800 rounded-2xl rounded-bl-sm"
                      }`}
                    >
                      {greeting?.isGreeting && !msg.isLoading && (
                        <button
                          onClick={() => handleCopyGreeting(msg.id, greeting.body)}
                          className="absolute top-2 right-2 text-[12px] text-gray-400 hover:text-[#2563EB] transition-colors"
                        >
                          {copiedMessageId === msg.id ? "✓ コピーしました" : "📋 コピー"}
                        </button>
                      )}

                      {msg.isLoading ? (
                        <div className="flex gap-1 py-1">
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      ) : msg.role === "assistant" ? (
                        <div className="text-sm leading-relaxed">
                          {greeting?.isGreeting && (
                            <div className="text-[12px] font-semibold text-[#2563EB] mb-2">{greeting.label}</div>
                          )}
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
                            {(greeting?.isGreeting ? greeting.body : msg.content).replace(/\n/g, "  \n")}
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
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="border-t border-gray-200 bg-white shrink-0">
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
                disabled={isSending || isAnalyzing}
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
                placeholder={isAnalyzing ? "分析中はメッセージを送信できません" : "メッセージを入力..."}
                disabled={isAnalyzing}
                rows={1}
                className="flex-1 resize-none border border-gray-300 rounded-xl px-4 py-3 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                style={{ maxHeight: "120px" }}
              />
              <button
                onClick={handleSend}
                disabled={(!inputValue.trim() && !attachedFile) || isSending || isAnalyzing}
                className={`bg-[#2563EB] text-white rounded-xl px-4 py-3 font-medium hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${isSending ? "animate-pulse" : ""}`}
              >
                {isSending ? "⏳" : "送信"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
