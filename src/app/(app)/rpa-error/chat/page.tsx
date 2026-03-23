"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { parseKnownErrorSuggestion, removeJsonBlock } from "@/lib/rpa-error/parseKnownErrorSuggestion";
import type { KnownErrorSuggestion } from "@/lib/rpa-error/parseKnownErrorSuggestion";
import RpaErrorNav from "@/components/rpa-error/RpaErrorNav";

type Message = { id: string; role: string; content: string; createdAt: string };
type ChatSession = { id: string; createdAt: string; messages: Message[]; errorLog?: { id: string } | null };
type Duplicate = { id: string; patternName: string; matchedKeywords: string[]; matchCount: number };

type KnownErrorForm = {
  patternName: string;
  keywords: string[];
  solution: string;
  solutionUrl: string;
  severity: string;
  // エラーログ情報（同時保存用）
  logMachineNumber: number;
  logFlowName: string;
  logErrorSummary: string;
  logOccurredAt: string;
};

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 既知エラー登録
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const [knownErrorModal, setKnownErrorModal] = useState<KnownErrorForm | null>(null);
  const [knownErrorKeywordInput, setKnownErrorKeywordInput] = useState("");
  const [knownErrorSaving, setKnownErrorSaving] = useState(false);
  const [knownErrorDuplicates, setKnownErrorDuplicates] = useState<Duplicate[]>([]);

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
    setDismissedSuggestions(new Set());
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
      setDismissedSuggestions(new Set());
      loadChats();
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !activeChatId || sending) return;
    const userMsg = input.trim();
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "80px";
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

  // 既知エラー登録モーダル（エラーログ同時保存対応）
  const openKnownErrorModal = async (suggestion: KnownErrorSuggestion) => {
    const form: KnownErrorForm = {
      patternName: suggestion.pattern_name,
      keywords: suggestion.keywords,
      solution: suggestion.solution.replace(/\\n/g, "\n"),
      solutionUrl: "",
      severity: suggestion.severity,
      logMachineNumber: 1,
      logFlowName: "00.スカウトメール送信",
      logErrorSummary: "",
      logOccurredAt: new Date().toISOString().slice(0, 16),
    };
    setKnownErrorModal(form);
    setKnownErrorKeywordInput("");
    setKnownErrorDuplicates([]);
    setKnownErrorToast("");

    // 重複チェック + エラー情報抽出を並行実行
    const tasks: Promise<void>[] = [];

    tasks.push(
      fetch("/api/rpa-error/known-errors/check-duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: suggestion.keywords }),
      }).then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setKnownErrorDuplicates(data.duplicates || []);
        }
      }).catch(() => {})
    );

    if (activeChatId) {
      tasks.push(
        fetch(`/api/rpa-error/chat/${activeChatId}/extract`, { method: "POST" }).then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            setKnownErrorModal((prev) => prev ? {
              ...prev,
              logMachineNumber: data.machineNumber || 1,
              logFlowName: data.flowName || "00.スカウトメール送信",
              logErrorSummary: data.errorSummary || "",
            } : prev);
          }
        }).catch(() => {})
      );
    }

    await Promise.all(tasks);
  };

  const [knownErrorToast, setKnownErrorToast] = useState("");

  const handleSaveKnownError = async () => {
    if (!knownErrorModal) return;
    setKnownErrorSaving(true);
    try {
      // 1. パターン登録
      const patternRes = await fetch("/api/rpa-error/known-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patternName: knownErrorModal.patternName,
          keywords: knownErrorModal.keywords,
          solution: knownErrorModal.solution,
          solutionUrl: knownErrorModal.solutionUrl,
          severity: knownErrorModal.severity,
        }),
      });

      if (!patternRes.ok) {
        setKnownErrorToast("パターン登録に失敗しました");
        setTimeout(() => setKnownErrorToast(""), 3000);
        return;
      }

      const patternData = await patternRes.json();
      const knownErrorId = patternData.error?.id;

      // 2. エラーログ保存
      try {
        const logRes = await fetch("/api/rpa-error/logs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            machineNumber: knownErrorModal.logMachineNumber,
            flowName: knownErrorModal.logFlowName,
            errorSummary: knownErrorModal.logErrorSummary,
            severity: knownErrorModal.severity,
            occurredAt: knownErrorModal.logOccurredAt,
            chatId: activeChatId,
            knownErrorId: knownErrorId || null,
          }),
        });

        if (logRes.ok) {
          setKnownErrorToast("エラーパターンとログを保存しました");
        } else {
          setKnownErrorToast("パターンは登録済み。ログの保存に失敗しました。エラー一覧から手動で登録してください");
        }
      } catch {
        setKnownErrorToast("パターンは登録済み。ログの保存に失敗しました。エラー一覧から手動で登録してください");
      }

      setKnownErrorModal(null);
      loadChats();
      setTimeout(() => setKnownErrorToast(""), 5000);
    } catch {
      setKnownErrorToast("保存に失敗しました");
      setTimeout(() => setKnownErrorToast(""), 3000);
    } finally {
      setKnownErrorSaving(false);
    }
  };

  const addKnownErrorKeyword = () => {
    const kw = knownErrorKeywordInput.trim();
    if (kw && knownErrorModal && !knownErrorModal.keywords.includes(kw)) {
      setKnownErrorModal({ ...knownErrorModal, keywords: [...knownErrorModal.keywords, kw] });
    }
    setKnownErrorKeywordInput("");
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

  const renderMessage = (m: Message, i: number) => {
    if (m.role === "user") {
      return (
        <div key={m.id || i} className="flex justify-end">
          <div className="max-w-[75%] rounded-lg px-4 py-2.5 text-[14px] whitespace-pre-wrap bg-[#2563EB] text-white">
            {formatContent(m.content)}
          </div>
        </div>
      );
    }

    // assistant message - check for suggestion
    const suggestion = parseKnownErrorSuggestion(m.content);
    const displayContent = suggestion ? removeJsonBlock(m.content) : m.content;
    const msgKey = m.id || String(i);

    return (
      <div key={msgKey} className="flex flex-col items-start gap-2">
        <div className="max-w-[75%] rounded-lg px-4 py-2.5 text-[14px] whitespace-pre-wrap bg-[#F3F4F6] text-[#374151]">
          {formatContent(displayContent)}
        </div>

        {/* 既知エラー登録提案カード */}
        {suggestion && !dismissedSuggestions.has(msgKey) && (
          <div className="max-w-[75%] bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-4">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-[#1E40AF] mb-2">
              <span>💡</span> 新しいエラーパターンとして登録しますか？
            </div>
            <div className="space-y-1.5 text-[13px] text-[#374151]">
              <div>
                <span className="text-[#6B7280]">パターン名:</span> {suggestion.pattern_name}
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[#6B7280]">キーワード:</span>
                {suggestion.keywords.map((kw) => (
                  <span key={kw} className="rounded-full bg-[#DBEAFE] px-2 py-0.5 text-[12px] text-[#1E40AF]">{kw}</span>
                ))}
              </div>
              <div>
                <span className="text-[#6B7280]">深刻度:</span>{" "}
                <span className={suggestion.severity === "緊急" ? "text-[#DC2626] font-semibold" : suggestion.severity === "要対応" ? "text-[#D97706]" : "text-[#9CA3AF]"}>
                  {suggestion.severity}
                </span>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => openKnownErrorModal(suggestion)}
                className="rounded-md bg-[#2563EB] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8]"
              >
                内容を確認して登録
              </button>
              <button
                onClick={() => setDismissedSuggestions((prev) => new Set(prev).add(msgKey))}
                className="text-[13px] text-[#6B7280] hover:text-[#374151]"
              >
                スキップ
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <RpaErrorNav />
    <div className="flex h-[calc(100vh-10rem)] gap-4">
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
      </div>

      {/* 右: チャットエリア */}
      <div className="flex-1 rounded-lg border border-[#E5E7EB] bg-white flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB]">
          <h2 className="text-[15px] font-semibold text-[#374151]">RPAエラー相談</h2>
          {activeChatId && messages.length > 0 && (
            <button onClick={handleExtract} disabled={extracting} className="rounded-md bg-[#16A34A] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#15803D] disabled:opacity-50">
              {extracting ? "抽出中..." : "エラーログに保存"}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!activeChatId && (
            <div className="flex items-center justify-center h-full text-[14px] text-[#9CA3AF]">
              左の「新規チャット」からエラー相談を開始してください
            </div>
          )}
          {messages.map((m, i) => renderMessage(m, i))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-[#F3F4F6] rounded-lg px-4 py-2.5 text-[14px] text-[#9CA3AF]">考え中...</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {activeChatId && (
          <div className="border-t border-[#E5E7EB] p-3">
            <div className="flex gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  const el = e.target;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 300) + "px";
                }}
                onKeyDown={handleKeyDown}
                placeholder="エラー内容を貼り付けてください..."
                style={{ minHeight: "80px", maxHeight: "300px" }}
                className="flex-1 resize-none overflow-y-auto rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
              />
              <button onClick={sendMessage} disabled={!input.trim() || sending} className="self-end rounded-md bg-[#2563EB] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50">送信</button>
            </div>
          </div>
        )}
      </div>

      {/* トースト */}
      {knownErrorToast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-[14px] font-medium text-white shadow-lg ${knownErrorToast.includes("失敗") ? "bg-[#DC2626]" : "bg-[#16A34A]"}`}>
          {knownErrorToast}
        </div>
      )}

      {/* エラーログ保存モーダル */}
      {saveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-[16px] font-semibold text-[#374151] mb-4">エラーログに保存</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">号機</label>
                <select value={saveModal.machineNumber} onChange={(e) => setSaveModal({ ...saveModal, machineNumber: parseInt(e.target.value), flowName: parseInt(e.target.value) <= 6 ? "00.スカウトメール送信" : "01.応募者一次返信・情報取り込み" })} className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]">
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
              <button onClick={handleSaveLog} disabled={saving || !saveModal.errorSummary} className="rounded-md bg-[#2563EB] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50">{saving ? "保存中..." : "保存"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 既知エラー登録モーダル */}
      {knownErrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-[16px] font-semibold text-[#374151] mb-4">エラーパターン登録 + エラーログ保存</h3>

            {/* 重複警告 */}
            {knownErrorDuplicates.length > 0 && (
              <div className="mb-4 rounded-md border border-[#F59E0B]/30 bg-[#FFFBEB] px-4 py-3 text-[13px] text-[#92400E]">
                <span className="font-semibold">⚠️ 類似パターンが登録済みです:</span>
                {knownErrorDuplicates.map((d) => (
                  <div key={d.id} className="mt-1">
                    「{d.patternName}」（キーワード一致: {d.matchedKeywords.join(", ")}）
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">パターン名</label>
                <input value={knownErrorModal.patternName} onChange={(e) => setKnownErrorModal({ ...knownErrorModal, patternName: e.target.value })} className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">キーワード</label>
                <div className="flex gap-2 mb-2">
                  <input
                    value={knownErrorKeywordInput}
                    onChange={(e) => setKnownErrorKeywordInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKnownErrorKeyword(); } }}
                    placeholder="キーワードを入力してEnter"
                    className="flex-1 rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]"
                  />
                  <button onClick={addKnownErrorKeyword} className="rounded-md bg-[#F3F4F6] px-3 py-2 text-[13px]">追加</button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {knownErrorModal.keywords.map((kw) => (
                    <span key={kw} className="inline-flex items-center gap-1 rounded-full bg-[#EEF2FF] px-2.5 py-0.5 text-[13px] text-[#2563EB]">
                      {kw}
                      <button onClick={() => setKnownErrorModal({ ...knownErrorModal, keywords: knownErrorModal.keywords.filter((k) => k !== kw) })} className="text-[#2563EB]/60 hover:text-[#2563EB]">&times;</button>
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">対応手順</label>
                <textarea value={knownErrorModal.solution} onChange={(e) => setKnownErrorModal({ ...knownErrorModal, solution: e.target.value })} rows={5} className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">対応手順URL（任意）</label>
                <input value={knownErrorModal.solutionUrl} onChange={(e) => setKnownErrorModal({ ...knownErrorModal, solutionUrl: e.target.value })} placeholder="https://..." className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">深刻度</label>
                <select value={knownErrorModal.severity} onChange={(e) => setKnownErrorModal({ ...knownErrorModal, severity: e.target.value })} className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]">
                  <option value="放置OK">放置OK</option>
                  <option value="要対応">要対応</option>
                  <option value="緊急">緊急</option>
                </select>
              </div>
            </div>

            {/* エラーログ情報 */}
            <div className="mt-5 border-t border-[#E5E7EB] pt-4">
              <h4 className="text-[14px] font-semibold text-[#374151] mb-3">エラーログ情報</h4>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-[13px] font-medium text-[#374151] mb-1">号機</label>
                    <select
                      value={knownErrorModal.logMachineNumber}
                      onChange={(e) => setKnownErrorModal({ ...knownErrorModal, logMachineNumber: parseInt(e.target.value), logFlowName: parseInt(e.target.value) <= 6 ? "00.スカウトメール送信" : "01.応募者一次返信・情報取り込み" })}
                      className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]"
                    >
                      {[1,2,3,4,5,6,7].map((n) => <option key={n} value={n}>{n}号機</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-[13px] font-medium text-[#374151] mb-1">発生日時</label>
                    <input type="datetime-local" value={knownErrorModal.logOccurredAt} onChange={(e) => setKnownErrorModal({ ...knownErrorModal, logOccurredAt: e.target.value })} className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]" />
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#374151] mb-1">フロー名</label>
                  <input value={knownErrorModal.logFlowName} onChange={(e) => setKnownErrorModal({ ...knownErrorModal, logFlowName: e.target.value })} className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]" />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#374151] mb-1">エラー概要</label>
                  <textarea value={knownErrorModal.logErrorSummary} onChange={(e) => setKnownErrorModal({ ...knownErrorModal, logErrorSummary: e.target.value })} rows={2} className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]" />
                </div>
              </div>
            </div>

            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setKnownErrorModal(null)} className="rounded-md bg-[#F3F4F6] px-4 py-2 text-[14px] font-medium text-[#374151] hover:bg-[#E5E7EB]">キャンセル</button>
              <button
                onClick={handleSaveKnownError}
                disabled={knownErrorSaving || !knownErrorModal.patternName || !knownErrorModal.keywords.length || !knownErrorModal.solution || !knownErrorModal.logErrorSummary}
                className="rounded-md bg-[#2563EB] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {knownErrorSaving ? "保存中..." : "パターン登録 + ログ保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
