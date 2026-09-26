"use client";

// T-205: 面談準備チャット（右から開く幅広のパネル。見た目は ChatGPT / Claude の会話画面）。
// - 材料はマイナビレジュメの文字だけ。最初の整理はヘッダー直下の固定欄、以降の会話は中央の列に並べる。
// - 既存の AIアドバイザー（AdvisorFloatingPanel）とは別コンポーネント・別API・別テーブル。
// - 応答はストリーミング（SSE）で書きながら表示し、表示が終わってから保存される（保存はサーバー側）。
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";

type PrepMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  userName: string | null;
};

type PrepState = {
  candidate: { id: string; name: string };
  room: {
    id: string;
    createdAt: string;
    careerType: string | null;
    resumeImportedAt: string | null;
    resumeChars: number;
    summary: { id: string; content: string; createdAt: string } | null;
    messages: PrepMessage[];
  } | null;
  resume: { fileId: string; importedAt: string } | null;
};

type Props = {
  candidateId: string;
  open: boolean;
  onClose: () => void;
};

const WIDTH_STORAGE_KEY = "interviewPrep.wide";
const TEXTAREA_MIN_PX = 72; // 3行（行高 24px）
const TEXTAREA_MAX_PX = 240; // 10行

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });
}

/** SSE を読む。text は onText、それ以外（done / error / started）は onEvent に渡す。 */
async function readSse(
  res: Response,
  onText: (t: string) => void,
  onEvent: (payload: Record<string, unknown>) => void,
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (typeof payload.text === "string") onText(payload.text);
        else onEvent(payload);
      }
    }
  }
}

function PrepMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
        h1: ({ children }) => <p className="font-bold text-base mt-4 mb-2">{children}</p>,
        h2: ({ children }) => <p className="font-bold text-base mt-4 mb-2">{children}</p>,
        h3: ({ children }) => <p className="font-bold text-[15px] mt-4 mb-2">{children}</p>,
        h4: ({ children }) => <p className="font-bold mt-3 mb-1">{children}</p>,
        ul: ({ children }) => <ul className="ml-5 mb-3 space-y-1 list-disc">{children}</ul>,
        ol: ({ children }) => <ol className="ml-5 mb-3 space-y-1 list-decimal">{children}</ol>,
        li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
        strong: ({ children }) => <strong className="font-bold">{children}</strong>,
        code: ({ children }) => <code className="bg-gray-100 rounded px-1 py-0.5 text-xs">{children}</code>,
        hr: () => <hr className="my-3 border-gray-200" />,
        table: ({ children }) => (
          <div className="overflow-x-auto mb-3">
            <table className="text-xs border-collapse">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border border-gray-200 px-2 py-1 bg-gray-50 text-left">{children}</th>,
        td: ({ children }) => <td className="border border-gray-200 px-2 py-1 align-top">{children}</td>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function BlinkCursor() {
  return <span className="inline-block w-[2px] h-[1em] align-text-bottom bg-gray-700 animate-pulse ml-0.5" />;
}

export default function InterviewPrepPanel({ candidateId, open, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<PrepState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 整理（固定欄）
  const [summary, setSummary] = useState<{ content: string; createdAt: string; careerType: string | null } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [streamSummary, setStreamSummary] = useState("");

  // 会話
  const [messages, setMessages] = useState<PrepMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamAnswer, setStreamAnswer] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);

  // エラー（再送の対象を kind で持つ）
  const [error, setError] = useState<{ kind: "summary" | "chat"; message: string; rebuild?: boolean } | null>(null);

  const [wide, setWide] = useState(false);
  const [mounted, setMounted] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMounted(true);
    try {
      setWide(localStorage.getItem(WIDTH_STORAGE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const applyState = useCallback((data: PrepState) => {
    setState(data);
    setMessages(data.room?.messages ?? []);
    setSummary(
      data.room?.summary
        ? { content: data.room.summary.content, createdAt: data.room.summary.createdAt, careerType: data.room.careerType }
        : null,
    );
  }, []);

  const fetchState = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/interview-prep`);
      if (!res.ok) throw new Error("状態の取得に失敗しました");
      const data = (await res.json()) as PrepState;
      applyState(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "状態の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [candidateId, applyState]);

  // 開いたときに状態を取り直し、整理は畳んだ状態で始める
  useEffect(() => {
    if (!open) return;
    setSummaryOpen(false);
    setError(null);
    setPendingQuestion(null);
    setStreamAnswer("");
    stickToBottomRef.current = true;
    void fetchState();
  }, [open, fetchState]);

  // Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // 新しい文字が出るたびに下へ（CA が上へスクロールして読み返しているときは止める）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streamAnswer, pendingQuestion, sending]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const toggleWide = () => {
    setWide((w) => {
      const next = !w;
      try {
        localStorage.setItem(WIDTH_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const runSummary = useCallback(
    async (rebuild: boolean) => {
      if (summarizing || sending) return;
      setError(null);
      setSummarizing(true);
      setStreamSummary("");
      setSummaryOpen(true);
      if (rebuild) {
        setSummary(null);
        setMessages([]);
        setPendingQuestion(null);
        setStreamAnswer("");
      }
      try {
        const res = await fetch(`/api/candidates/${candidateId}/interview-prep/summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rebuild }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string; chars?: number };
          if (res.status === 422 && body.error === "no_resume") {
            setState((s) => (s ? { ...s, resume: null, room: rebuild ? s.room : null } : s));
            if (rebuild) {
              setError({ kind: "summary", message: "マイナビレジュメが見つからないため、作り直しはできません。今の整理をそのまま使えます。" });
              await fetchState();
            }
            return;
          }
          if (res.status === 422 && body.error === "resume_unreadable") {
            setError({
              kind: "summary",
              rebuild,
              message: `マイナビレジュメの文字を読み取れません（読み取れたのは ${body.chars ?? 0} 字。200字以上が必要です）。`,
            });
            if (rebuild) await fetchState();
            return;
          }
          if (res.status === 409) {
            await fetchState();
            return;
          }
          setError({ kind: "summary", rebuild, message: body.error || "整理の作成に失敗しました。" });
          return;
        }
        let finished = false;
        await readSse(
          res,
          (t) => setStreamSummary((prev) => prev + t),
          (payload) => {
            if (payload.done) {
              finished = true;
              const s = payload.summary as { content: string; createdAt: string };
              setSummary({ content: s.content, createdAt: s.createdAt, careerType: (payload.careerType as string | null) ?? null });
              setState((prev) =>
                prev
                  ? {
                      ...prev,
                      room: {
                        id: String(payload.roomId),
                        createdAt: s.createdAt,
                        careerType: (payload.careerType as string | null) ?? null,
                        resumeImportedAt: prev.room?.resumeImportedAt ?? prev.resume?.importedAt ?? null,
                        resumeChars: prev.room?.resumeChars ?? 0,
                        summary: { id: "", content: s.content, createdAt: s.createdAt },
                        messages: [],
                      },
                    }
                  : prev,
              );
            } else if (typeof payload.error === "string") {
              setError({ kind: "summary", rebuild, message: payload.error });
            }
          },
        );
        if (!finished) {
          setError((e) => e ?? { kind: "summary", rebuild, message: "整理の作成が途中で止まりました。再送してください。" });
        }
      } catch (e) {
        setError({ kind: "summary", rebuild, message: e instanceof Error ? e.message : "整理の作成に失敗しました。" });
      } finally {
        setSummarizing(false);
        setStreamSummary("");
      }
    },
    [candidateId, summarizing, sending, fetchState],
  );

  const runChat = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || sending || summarizing) return;
      setError(null);
      setSending(true);
      setPendingQuestion(q);
      setStreamAnswer("");
      stickToBottomRef.current = true;
      try {
        const res = await fetch(`/api/candidates/${candidateId}/interview-prep/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: q }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (res.status === 409) {
            setError({ kind: "chat", message: "先に整理を作ってください。" });
            await fetchState();
            return;
          }
          setError({ kind: "chat", message: body.error || "送信に失敗しました。" });
          return;
        }
        let finished = false;
        await readSse(
          res,
          (t) => setStreamAnswer((prev) => prev + t),
          (payload) => {
            if (payload.done) {
              finished = true;
              const um = payload.userMessage as PrepMessage;
              const am = payload.assistantMessage as PrepMessage;
              setMessages((prev) => [...prev, um, am]);
              setPendingQuestion(null);
            } else if (typeof payload.error === "string") {
              setError({ kind: "chat", message: payload.error });
            }
          },
        );
        if (!finished) {
          setError((e) => e ?? { kind: "chat", message: "応答が途中で止まりました。再送してください。" });
        }
      } catch (e) {
        setError({ kind: "chat", message: e instanceof Error ? e.message : "送信に失敗しました。" });
      } finally {
        setSending(false);
        setStreamAnswer("");
      }
    },
    [candidateId, sending, summarizing, fetchState],
  );

  const handleSend = () => {
    const q = input.trim();
    if (!q) return;
    setInput("");
    const el = textareaRef.current;
    if (el) el.style.height = `${TEXTAREA_MIN_PX}px`;
    void runChat(q);
  };

  const handleResend = () => {
    if (!error) return;
    if (error.kind === "summary") void runSummary(error.rebuild === true);
    else if (pendingQuestion) void runChat(pendingQuestion);
  };

  const handleRebuild = () => {
    if (summarizing || sending) return;
    const ok = window.confirm(
      "面談準備を作り直しますか？\n今の整理と会話は非表示になり、マイナビレジュメの文字を取り直して整理から始めます。",
    );
    if (!ok) return;
    void runSummary(true);
  };

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, TEXTAREA_MIN_PX), TEXTAREA_MAX_PX)}px`;
  };

  if (!open || !mounted) return null;

  const candidateName = state?.candidate.name ?? "";
  const importedAt = state?.room?.resumeImportedAt ?? state?.resume?.importedAt ?? null;
  const hasRoom = !!summary;
  const noResume = !state?.room && !state?.resume;
  const busy = summarizing || sending;
  const width = wide ? "95vw" : "clamp(720px, 60vw, calc(100vw - 48px))";

  const panel = (
    <div
      role="dialog"
      aria-label="面談準備"
      className="fixed top-0 right-0 h-screen bg-white border-l border-gray-200 shadow-2xl z-[70] flex flex-col"
      style={{ width, maxWidth: "calc(100vw - 48px)" }}
    >
      {/* ヘッダー */}
      <div className="flex items-start gap-3 px-5 py-3 border-b border-gray-200 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-gray-900 truncate">
            面談準備｜{candidateName ? `${candidateName} さん` : ""}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            材料: マイナビレジュメ{importedAt ? `（${formatDate(importedAt)} 取り込み）` : "（未取り込み）"}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={toggleWide}
            className="px-2.5 py-1 rounded-md text-[12px] border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            {wide ? "元の幅" : "広げる"}
          </button>
          {hasRoom && (
            <button
              type="button"
              onClick={handleRebuild}
              disabled={busy}
              className="px-2.5 py-1 rounded-md text-[12px] border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              作り直す
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="w-8 h-8 rounded-md text-gray-500 hover:bg-gray-100 text-lg leading-none"
          >
            ×
          </button>
        </div>
      </div>

      {/* 整理の固定欄 */}
      {(hasRoom || summarizing) && (
        <div className="border-b border-gray-200 bg-gray-50/60 shrink-0">
          <div className="flex items-center gap-2 px-5 py-2">
            <span className="text-[13px] font-medium text-gray-700">
              整理{summary ? `（${formatDate(summary.createdAt)}）` : summarizing ? "（作成中）" : ""}
            </span>
            {summary?.careerType && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                {summary.careerType}
              </span>
            )}
            {!summarizing && (
              <button
                type="button"
                onClick={() => setSummaryOpen((v) => !v)}
                className="ml-auto text-[12px] text-blue-600 hover:underline"
              >
                {summaryOpen ? "整理を閉じる" : "整理を開く"}
              </button>
            )}
          </div>
          {(summaryOpen || summarizing) && (
            <div className="max-h-[50vh] overflow-y-auto px-5 pb-4">
              <div className="max-w-[760px] mx-auto text-sm text-gray-800">
                {summarizing ? (
                  <>
                    <PrepMarkdown text={streamSummary} />
                    <BlinkCursor />
                  </>
                ) : (
                  <PrepMarkdown text={summary?.content ?? ""} />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 会話欄 */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-5 py-4">
        <div className="max-w-[760px] mx-auto">
          {loading && !state ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin h-6 w-6 border-3 border-[#2563EB] border-t-transparent rounded-full" />
            </div>
          ) : loadError ? (
            <div className="text-center text-sm text-red-600 py-16">
              {loadError}
              <div className="mt-3">
                <button type="button" onClick={() => void fetchState()} className="text-blue-600 hover:underline">
                  再読み込み
                </button>
              </div>
            </div>
          ) : !hasRoom && !summarizing ? (
            noResume ? (
              <div className="text-center py-16">
                <p className="text-base font-medium text-gray-700 mb-2">マイナビレジュメが見つかりません</p>
                <p className="text-sm text-gray-500">
                  書類タブの「面談」にマイナビレジュメ（RPA 自動取り込みの PDF）が入ると使えるようになります。
                </p>
                {error && <p className="text-sm text-red-600 mt-4">{error.message}</p>}
              </div>
            ) : (
              <div className="text-center py-16">
                <p className="text-lg font-medium text-gray-800 mb-2">面談の準備を始めましょう</p>
                <p className="text-sm text-gray-500 mb-6">
                  マイナビレジュメの記載だけを使い、本人の事実・職種の解説・面談で聞く質問を整理します。
                </p>
                <button
                  type="button"
                  onClick={() => void runSummary(false)}
                  disabled={busy}
                  className="inline-flex items-center px-5 py-2.5 rounded-md text-[14px] font-medium bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                >
                  面談準備を作る
                </button>
                {error && (
                  <div className="mt-6 text-sm text-red-600">
                    {error.message}
                    <div className="mt-2">
                      <button type="button" onClick={handleResend} className="text-blue-600 hover:underline">
                        再送
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="space-y-6">
              {summarizing && messages.length === 0 && (
                <p className="text-center text-sm text-gray-400 py-8">整理を作成しています…</p>
              )}
              {!summarizing && messages.length === 0 && !pendingQuestion && (
                <p className="text-center text-sm text-gray-400 py-8">
                  整理を読んで、気になることを下の入力欄から質問してください。
                </p>
              )}
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] bg-gray-100 rounded-2xl px-4 py-2.5 text-sm text-gray-900 whitespace-pre-wrap">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="text-sm text-gray-800">
                    <PrepMarkdown text={m.content} />
                  </div>
                ),
              )}
              {pendingQuestion && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] bg-gray-100 rounded-2xl px-4 py-2.5 text-sm text-gray-900 whitespace-pre-wrap">
                    {pendingQuestion}
                  </div>
                </div>
              )}
              {sending && (
                <div className="text-sm text-gray-800">
                  {streamAnswer ? <PrepMarkdown text={streamAnswer} /> : null}
                  <BlinkCursor />
                </div>
              )}
              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error.message}
                  <div className="mt-2">
                    <button type="button" onClick={handleResend} className="text-blue-600 hover:underline">
                      再送
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 入力欄 */}
      {hasRoom && (
        <div className="border-t border-gray-200 px-5 py-4 shrink-0 bg-white">
          <div className="max-w-[760px] mx-auto">
            <div className="rounded-2xl border border-gray-300 shadow-sm focus-within:border-blue-400 px-4 pt-3 pb-2">
              <textarea
                ref={textareaRef}
                value={input}
                rows={3}
                disabled={busy}
                placeholder="レジュメについて聞きたいことを入力…"
                onChange={(e) => {
                  setInput(e.target.value);
                  resizeTextarea();
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                className="w-full resize-none outline-none text-sm leading-6 text-gray-900 placeholder:text-gray-400 bg-transparent disabled:opacity-60"
                style={{ minHeight: TEXTAREA_MIN_PX, maxHeight: TEXTAREA_MAX_PX, overflowY: "auto" }}
              />
              <div className="flex items-end justify-between mt-1">
                <span className="text-[11px] text-gray-400">Enterで改行・Ctrl+Enterで送信</span>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={busy || !input.trim()}
                  aria-label="送信"
                  className="w-9 h-9 rounded-full bg-[#2563EB] text-white flex items-center justify-center hover:bg-[#1D4ED8] disabled:opacity-40"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12l7-7 7 7M12 5v14" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(panel, document.body);
}
