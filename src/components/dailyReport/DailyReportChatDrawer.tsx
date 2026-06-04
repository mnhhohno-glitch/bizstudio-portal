"use client";

// T-066: 日報 AI チャットドロワー（右からスライドイン）。
// ScheduleChatDrawer をベースにしつつ、対象は「日報生成」固有のフロー：
//   - 社員コメント入力 → AI と数往復 → 日報本文(report) 確定 → DRAFT/SUBMITTED 保存
// API：POST /api/daily-report/chat（AI 往復＋下書き保存）、POST /api/daily-report（最終確定）
// AI へは生レコードを送らない（仕様 #10）。会話側は date と message と comment だけを渡す。

import { useState, useRef, useEffect, useCallback } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  reportPreview?: string;
};

type ScheduleHighlight = {
  title: string;
  time: string;
  status: "完了" | "未完了";
};

type ReportContextInfo = {
  format: "CA" | "MARKETING" | "OFFICE_AND_MGMT" | "FALLBACK_COMMENT_ONLY";
  scheduleSummary: {
    plannedCount: number;
    completedCount: number;
    highlights: ScheduleHighlight[];
  };
  metricsSummary: string | null;
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  date: string;
}

export default function DailyReportChatDrawer({ isOpen, onClose, date }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [comment, setComment] = useState("");
  const [reportBody, setReportBody] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [context, setContext] = useState<ReportContextInfo | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dateObj = new Date(date + "T00:00:00");
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const dateLabel = `${dateObj.getMonth() + 1}/${dateObj.getDate()}（${weekdays[dateObj.getDay()]}）`;

  // 初回ロード：日報状況と職種・予実サマリ取得
  const fetchInitial = useCallback(async () => {
    try {
      const res = await fetch(`/api/daily-report?date=${date}`);
      if (!res.ok) return;
      const data = await res.json();
      const summary = data.scheduleSummary;
      const metricsSummary = data.metrics
        ? `初回面談 ${data.metrics.firstInterviewExecuted}/${data.metrics.firstInterviewPlanned}、求人検索 ${data.metrics.jobSearched}、紹介 ${data.metrics.jobIntroduced}`
        : null;
      setContext({
        format: data.format,
        scheduleSummary: summary,
        metricsSummary,
      });
      if (data.report?.comment) setComment(data.report.comment);
      if (data.report?.aiBody) setReportBody(data.report.aiBody);

      const welcome: string[] = [];
      welcome.push(`${dateLabel} の日報を作りましょう。`);
      welcome.push(`予定 ${summary.plannedCount} 件 / 完了 ${summary.completedCount} 件。`);
      if (data.format === "CA" && metricsSummary) {
        welcome.push(metricsSummary);
      } else if (data.format !== "CA") {
        welcome.push("コメントベースで日報を組み立てます。");
      }
      welcome.push("");
      welcome.push("コメント欄にメモを書きながら、気になる点や明日のタスクを話しかけてください。");
      setMessages([
        {
          id: "welcome",
          role: "assistant",
          content: welcome.join("\n"),
        },
      ]);
    } catch (e) {
      console.error("[DailyReportChatDrawer] initial fetch error", e);
    }
  }, [date, dateLabel]);

  useEffect(() => {
    if (isOpen) {
      setMessages([]);
      setReportBody("");
      void fetchInitial();
    }
  }, [isOpen, fetchInitial]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;
    setInputValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const userMsg: ChatMessage = {
      id: "u-" + Date.now(),
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const history = messages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/daily-report/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, message: text, comment, chatHistory: history }),
      });
      const data = await res.json();
      const aiMsg: ChatMessage = {
        id: "a-" + Date.now(),
        role: "assistant",
        content: data.message || "応答を取得できませんでした。",
        reportPreview: typeof data.report === "string" ? data.report : undefined,
      };
      setMessages((prev) => [...prev, aiMsg]);
      if (typeof data.report === "string" && data.report.length > 0) {
        setReportBody(data.report);
      }
    } catch (e) {
      console.error("[DailyReportChatDrawer] chat error", e);
      setMessages((prev) => [
        ...prev,
        {
          id: "err-" + Date.now(),
          role: "assistant",
          content: "エラーが発生しました。もう一度お試しください。",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    setSubmitting(true);
    try {
      await fetch("/api/daily-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, comment, aiBody: reportBody, submit: false }),
      });
      onClose();
    } catch (e) {
      console.error("[DailyReportChatDrawer] draft save error", e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!reportBody.trim()) {
      alert("日報本文がまだ生成されていません。AI に話しかけて日報を作ってください。");
      return;
    }
    if (!confirm("この日報を確定して保存しますか？")) return;
    setSubmitting(true);
    try {
      await fetch("/api/daily-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, comment, aiBody: reportBody, submit: true }),
      });
      onClose();
    } catch (e) {
      console.error("[DailyReportChatDrawer] submit error", e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />}
      <div
        className={`fixed top-0 right-0 h-full bg-white shadow-xl z-50 flex flex-col transition-transform duration-300 w-full sm:w-[520px] ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 shrink-0">
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg" aria-label="閉じる">
            ✕
          </button>
          <h2 className="text-[14px] font-semibold text-[#374151]">📝 {dateLabel} の日報</h2>
          {context && (
            <span className="ml-auto text-[11px] text-[#6B7280]">
              {context.format === "CA" ? "CA（数値入り）" : context.format === "MARKETING" ? "マーケ" : "事務・管理"}
            </span>
          )}
        </div>

        {/* コメント入力（社員の素材） */}
        <div className="border-b border-gray-200 px-4 py-2 shrink-0 bg-[#F9FAFB]">
          <label className="text-[11px] text-[#6B7280] mb-1 block">コメント（AI が日報を組み立てる素材）</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="今日の気づき・トピック・明日への申し送りを書いてください…"
            rows={2}
            className="w-full resize-none border border-gray-300 rounded-md px-2 py-1 text-[12px] focus:border-[#2563EB] focus:outline-none"
          />
        </div>

        {/* チャット */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.map((msg) => (
            <div key={msg.id}>
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
              {msg.reportPreview && (
                <div className="mt-2 ml-9 border border-gray-200 rounded-lg p-3 bg-white">
                  <p className="text-[11px] text-[#6B7280] font-medium mb-2">── 日報プレビュー ──</p>
                  <pre className="text-[12px] text-[#374151] whitespace-pre-wrap font-sans">{msg.reportPreview}</pre>
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

        {/* 入力 + アクション */}
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
              placeholder="AI に話しかけて日報を仕上げる…"
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
              onClick={handleSaveDraft}
              disabled={submitting}
              className="flex-1 border border-gray-300 text-gray-700 rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              💾 下書き保存
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !reportBody.trim()}
              className="flex-1 bg-[#16A34A] text-white rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[#15803D] disabled:opacity-50"
            >
              ✅ 確定
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
