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

type TodayEntry = {
  id: string;
  title: string;
  isCompleted: boolean;
  startTime: string;
  endTime: string;
  tag: string;
  tagColor: string;
};

type CalendarEvent = { summary: string; start: string; end: string };

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tomorrowEntries?: Entry[];
  timestamp: Date;
};

interface ScheduleReviewDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  date: string;
  scheduleId: string;
  todayEntries: TodayEntry[];
  tomorrowCalendarEvents: CalendarEvent[];
  onSave: (review: string, tomorrowEntries: Entry[], tomorrowSummary: string) => void;
}

export default function ScheduleReviewDrawer({
  isOpen,
  onClose,
  date,
  scheduleId,
  todayEntries,
  tomorrowCalendarEvents,
  onSave,
}: ScheduleReviewDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentPhase, setCurrentPhase] = useState<"REVIEW" | "PLANNING">("REVIEW");
  const [currentReview, setCurrentReview] = useState<string | null>(null);
  const [tomorrowEntries, setTomorrowEntries] = useState<Entry[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dateObj = new Date(date + "T00:00:00");
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const dateLabel = `${dateObj.getMonth() + 1}/${dateObj.getDate()}（${weekdays[dateObj.getDay()]}）`;

  useEffect(() => {
    if (!isOpen) return;
    setCurrentPhase("REVIEW");
    setCurrentReview(null);
    setTomorrowEntries([]);
    setHasChanges(false);

    const completedCount = todayEntries.filter((e) => e.isCompleted).length;
    const totalCount = todayEntries.length;

    const lines = [
      `お疲れさまでした。今日の振り返りをしましょう。`,
      "",
      `📊 今日の結果: ${completedCount}/${totalCount} 完了`,
      ...todayEntries.map((e) => `・${e.startTime} ${e.title} ${e.isCompleted ? "✅" : "❌"}`),
      "",
      "計画通りにいかなかった部分や、気づいたことはありますか？",
    ];

    setMessages([{
      id: "welcome",
      role: "assistant",
      content: lines.join("\n"),
      timestamp: new Date(),
    }]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleClose = () => {
    if (hasChanges && !confirm("振り返りが保存されていません。閉じてもよろしいですか？")) return;
    onClose();
  };

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;

    setInputValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    setMessages((prev) => [...prev, { id: "user-" + Date.now(), role: "user", content: text, timestamp: new Date() }]);
    setIsLoading(true);
    setHasChanges(true);

    try {
      const chatHistory = messages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({
          role: m.role,
          content: m.role === "assistant" && m.tomorrowEntries
            ? JSON.stringify({ message: m.content, phase: currentPhase, review: currentReview, tomorrowEntries: m.tomorrowEntries })
            : m.content,
        }));

      const res = await fetch("/api/schedule/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduleId,
          message: text,
          chatHistory,
          todayEntries: todayEntries.map((e) => ({
            title: e.title,
            isCompleted: e.isCompleted,
            startTime: e.startTime,
            endTime: e.endTime,
            tag: e.tag,
          })),
          tomorrowCalendarEvents,
        }),
      });

      const data = await res.json();

      if (data.phase) setCurrentPhase(data.phase);
      if (data.review) setCurrentReview(data.review);
      if (data.tomorrowEntries && data.tomorrowEntries.length > 0) {
        setTomorrowEntries(data.tomorrowEntries);
      }

      setMessages((prev) => [...prev, {
        id: "ai-" + Date.now(),
        role: "assistant",
        content: data.message || "応答を取得できませんでした",
        tomorrowEntries: data.tomorrowEntries?.length > 0 ? data.tomorrowEntries : undefined,
        timestamp: new Date(),
      }]);
    } catch {
      setMessages((prev) => [...prev, {
        id: "error-" + Date.now(),
        role: "assistant",
        content: "エラーが発生しました。もう一度お試しください。",
        timestamp: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleConfirm = () => {
    const review = currentReview || "振り返り完了";
    const summary = tomorrowEntries.map((e) => `${e.startTime} ${e.title}`).join(" → ");
    onSave(review, tomorrowEntries, summary);
  };

  const lastTomorrowMsg = [...messages].reverse().find((m) => m.tomorrowEntries && m.tomorrowEntries.length > 0);

  const canSaveFull = currentPhase === "PLANNING" && tomorrowEntries.length > 0;

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/30 z-40" onClick={handleClose} />}

      <div className={`fixed top-0 right-0 h-full bg-white shadow-xl z-50 flex flex-col transition-transform duration-300 w-full sm:w-[480px] ${isOpen ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 shrink-0">
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
          <h2 className="text-[14px] font-semibold text-[#374151]">🌙 {dateLabel}の振り返り</h2>
          <span className={`ml-auto text-[11px] rounded-full px-2 py-0.5 ${currentPhase === "REVIEW" ? "bg-yellow-100 text-yellow-700" : "bg-blue-100 text-blue-700"}`}>
            {currentPhase === "REVIEW" ? "振り返り中" : "翌日計画中"}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.map((msg) => (
            <div key={msg.id}>
              <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start gap-2"}`}>
                {msg.role === "assistant" && (
                  <div className="w-7 h-7 bg-[#F4F7F9] rounded-full flex items-center justify-center text-[12px] shrink-0 mt-0.5">🤖</div>
                )}
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] whitespace-pre-wrap ${msg.role === "user" ? "bg-[#2563EB] text-white rounded-br-sm" : "bg-[#F4F7F9] text-[#374151] rounded-bl-sm"}`}>
                  {msg.content}
                </div>
              </div>
              {msg.tomorrowEntries && msg.tomorrowEntries.length > 0 && msg.id === lastTomorrowMsg?.id && (
                <div className="mt-2 ml-9 border border-gray-200 rounded-lg p-3 bg-white">
                  <p className="text-[11px] text-[#6B7280] font-medium mb-2">── 明日のプレビュー ──</p>
                  <DailyTimeline
                    entries={msg.tomorrowEntries.map((e) => ({
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
              <div className="w-7 h-7 bg-[#F4F7F9] rounded-full flex items-center justify-center text-[12px] shrink-0">🤖</div>
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

        <div className="border-t border-gray-200 px-4 py-3 shrink-0 space-y-2">
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); const el = e.target; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 100) + "px"; }}
              onKeyDown={handleKeyDown}
              placeholder="振り返りを入力..."
              rows={1}
              disabled={isLoading}
              className="flex-1 resize-none border border-gray-300 rounded-lg px-3 py-2 text-[13px] focus:border-[#2563EB] focus:outline-none disabled:opacity-50"
              style={{ maxHeight: "100px" }}
            />
            <button onClick={handleSend} disabled={!inputValue.trim() || isLoading} className="bg-[#2563EB] text-white rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50 shrink-0">
              {isLoading ? "..." : "送信"}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={!hasChanges || isLoading}
              className="flex-1 bg-[#16A34A] text-white rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[#15803D] disabled:opacity-50"
            >
              {canSaveFull ? "💾 振り返りを保存 & 明日のスケジュール確定" : "💾 振り返りのみ保存"}
            </button>
            <button onClick={handleClose} className="border border-gray-300 text-gray-700 rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-gray-50">
              キャンセル
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
