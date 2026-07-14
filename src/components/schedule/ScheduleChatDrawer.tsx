"use client";

import { useState, useRef, useEffect } from "react";
import DailyTimeline from "./DailyTimeline";

type Entry = {
  startTime: string;
  endTime: string;
  title: string;
  note?: string | null;
  tag: string;
  tagColor: string;
  sortOrder: number;
};

type CalendarEvent = {
  summary: string;
  start: string;
  end: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  entries?: Entry[];
  timestamp: Date;
};

interface ScheduleChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  date: string;
  scheduleId: string | null;
  existingEntries: Entry[];
  calendarEvents: CalendarEvent[];
  onSave: (entries: Entry[], summary: string) => void;
  // T-084: 明日枠用に対象日を変更できるようにする（デフォルト=翌営業日、変更で再同期）。
  allowDateChange?: boolean;
  onDateChange?: (newDate: string) => void;
}

export default function ScheduleChatDrawer({
  isOpen,
  onClose,
  date,
  scheduleId,
  existingEntries,
  calendarEvents,
  onSave,
  allowDateChange,
  onDateChange,
}: ScheduleChatDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentEntries, setCurrentEntries] = useState<Entry[]>(existingEntries);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasAiEntries, setHasAiEntries] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Format date for display
  const dateObj = new Date(date + "T00:00:00");
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const dateLabel = `${dateObj.getMonth() + 1}/${dateObj.getDate()}（${weekdays[dateObj.getDay()]}）`;

  // Initialize with welcome message
  useEffect(() => {
    if (isOpen) {
      setCurrentEntries(existingEntries);
      setHasAiEntries(false);
      const welcomeParts: string[] = [];

      welcomeParts.push("スケジュールを作りましょう。");

      if (calendarEvents.length > 0) {
        welcomeParts.push("Googleカレンダーから以下の予定を取得しました：");
        calendarEvents.forEach((e) => {
          welcomeParts.push(`・${e.start}〜${e.end} ${e.summary}`);
        });
        welcomeParts.push("");
      }

      if (existingEntries.length > 0) {
        welcomeParts.push("現在のスケジュール:");
        existingEntries.forEach((e) => {
          welcomeParts.push(`・${e.startTime}〜${e.endTime} ${e.title}（${e.tag}）`);
        });
        welcomeParts.push("");
        welcomeParts.push("変更したい内容を教えてください。");
      } else {
        welcomeParts.push(calendarEvents.length > 0 ? "これ以外の予定を教えてください。" : "予定を教えてください。");
      }

      setMessages([{
        id: "welcome",
        role: "assistant",
        content: welcomeParts.join("\n"),
        timestamp: new Date(),
      }]);
    }
  // T-084: 日付・カレンダーが変わったら welcome を作り直し（明日枠で日付変更→カレンダー再取得が反映される）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, date, calendarEvents]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;

    setInputValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const userMsg: ChatMessage = {
      id: "user-" + Date.now(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      // Build chat history for API (exclude welcome message and entries)
      const chatHistory = messages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({
          role: m.role,
          content: m.role === "assistant" && m.entries
            ? JSON.stringify({ message: m.content, entries: m.entries })
            : m.content,
        }));

      const res = await fetch("/api/schedule/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduleId,
          date,
          message: text,
          calendarEvents,
          existingEntries: currentEntries.map((e) => ({
            startTime: e.startTime,
            endTime: e.endTime,
            title: e.title,
            tag: e.tag,
          })),
          chatHistory,
        }),
      });

      const data = await res.json();

      const aiMsg: ChatMessage = {
        id: "ai-" + Date.now(),
        role: "assistant",
        content: data.message || "応答を取得できませんでした",
        entries: data.entries || undefined,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiMsg]);

      if (data.entries && Array.isArray(data.entries)) {
        setCurrentEntries(data.entries);
        if (data.entries.length > 0) setHasAiEntries(true);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: "error-" + Date.now(),
          role: "assistant",
          content: "エラーが発生しました。もう一度お試しください。",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (isConfirming) return;
    if (hasAiEntries && !confirm("スケジュールが保存されていません。閉じてもよろしいですか？")) return;
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleConfirm = async () => {
    // 二重押し防止：disabled と併せてハンドラ冒頭でもガードする（レンダー間の再入を防ぐ）。
    if (isConfirming) return;
    setIsConfirming(true);
    try {
      const summary = currentEntries
        .map((e) => `${e.startTime} ${e.title}`)
        .join(" → ");
      // onSave の型は () => void だが、実際の呼び出し元は async 関数（PUT/POST /api/schedule）。
      // Promise.resolve でラップすると sync/async 両対応で完了まで待てる。
      await Promise.resolve(onSave(currentEntries, summary));
    } finally {
      // 成功・失敗どちらでも必ずロック解除。失敗時に「登録中…」で固まらないように。
      setIsConfirming(false);
    }
  };

  // Find the last message with entries for preview
  const lastEntriesMsg = [...messages].reverse().find((m) => m.entries && m.entries.length > 0);

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/30 z-40" onClick={handleClose} />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full bg-white shadow-xl z-50 flex flex-col transition-transform duration-300 w-full sm:w-[480px] ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 shrink-0 flex-wrap">
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
          <h2 className="text-[14px] font-semibold text-[#374151]">
            📅 {dateLabel}のスケジュールを作成
          </h2>
          {/* T-084: 明日枠のときだけ対象日変更＋カレンダー再同期 */}
          {allowDateChange && onDateChange && (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-[11px] text-[#6B7280]">対象日</span>
              <input
                type="date"
                value={date}
                onChange={(e) => { if (e.target.value) onDateChange(e.target.value); }}
                className="text-[12px] border border-gray-300 rounded px-1.5 py-0.5"
              />
              <button
                onClick={() => onDateChange(date)}
                title="この日のGoogleカレンダー予定を再取得"
                className="text-[11px] border border-[#2563EB] text-[#2563EB] rounded px-1.5 py-0.5 hover:bg-blue-50"
              >🔄 再同期</button>
            </div>
          )}
        </div>

        {/* Chat area */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.map((msg) => (
            <div key={msg.id}>
              {/* Message bubble */}
              <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start gap-2"}`}>
                {msg.role === "assistant" && (
                  <div className="w-7 h-7 bg-[#F4F7F9] rounded-full flex items-center justify-center text-[12px] shrink-0 mt-0.5">
                    🤖
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-[#2563EB] text-white rounded-br-sm"
                      : "bg-[#F4F7F9] text-[#374151] rounded-bl-sm"
                  }`}
                >
                  {msg.content}
                </div>
              </div>

              {/* Preview (only for the last AI message with entries) */}
              {msg.entries && msg.entries.length > 0 && msg.id === lastEntriesMsg?.id && (
                <div className="mt-2 ml-9 border border-gray-200 rounded-lg p-3 bg-white">
                  <p className="text-[11px] text-[#6B7280] font-medium mb-2">── プレビュー ──</p>
                  <DailyTimeline
                    entries={msg.entries.map((e) => ({
                      startTime: e.startTime,
                      endTime: e.endTime,
                      title: e.title,
                      note: e.note,
                      tag: e.tag,
                      tagColor: e.tagColor,
                    }))}
                  />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start gap-2">
              <div className="w-7 h-7 bg-[#F4F7F9] rounded-full flex items-center justify-center text-[12px] shrink-0">
                🤖
              </div>
              <div className="bg-[#F4F7F9] rounded-xl px-3 py-2">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-gray-200 px-4 py-3 shrink-0 space-y-2">
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 100) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder="予定を教えてください..."
              rows={1}
              disabled={isLoading}
              className="flex-1 resize-none border border-gray-300 rounded-lg px-3 py-2 text-[13px] focus:border-[#2563EB] focus:outline-none disabled:opacity-50"
              style={{ maxHeight: "100px" }}
            />
            <button
              onClick={handleSend}
              disabled={!inputValue.trim() || isLoading}
              className="bg-[#2563EB] text-white rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50 shrink-0"
            >
              {isLoading ? "..." : "送信"}
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={currentEntries.length === 0 || isLoading || isConfirming}
              className="flex-1 bg-[#16A34A] text-white rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[#15803D] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isConfirming ? (
                <>
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                  登録中…
                </>
              ) : (
                <>💾 このスケジュールで確定</>
              )}
            </button>
            <button
              onClick={handleClose}
              disabled={isConfirming}
              className="border border-gray-300 text-gray-700 rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              キャンセル
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
