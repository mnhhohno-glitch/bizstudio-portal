"use client";

// T-205: 面談準備チャット（右から開く幅広のパネル。見た目は ChatGPT / Claude の会話画面）。
// - 材料は書類の「面談」フォルダの最新 PDF（マイナビレジュメなど。step12 で取り込み経路は不問）の文字と、会社の下調べ（ネット検索。T-205 step4・step7 で学校の下調べはやめた）。
// - step11: 整理は会話の先頭のメッセージとして置き、その下に CA の質問と AI の回答を時系列で並べる。
//   スクロールするのはヘッダーと入力欄の間の1つだけ（上部のバーの「整理へ移動」で先頭へ戻る）。
// - 既存の AIアドバイザー（AdvisorFloatingPanel）とは別コンポーネント・別API・別テーブル。
// - 応答はストリーミング（SSE）で書きながら表示し、表示が終わってから保存される（保存はサーバー側）。
// - step8: 最初の整理は決まった項目（summary_json）で受け取り、カード（InterviewPrepSummaryCards）に組み立てて一度に表示する。
//   質問には「聞いた」ボタン（asked_questions に保存）。summary_json が無い古い部屋は今までの文章表示のまま。
//   CA の質問への回答は今までどおり文章のストリーミング。
// - T-208 step3（付録G）: 入力欄の上に「よく使う質問」5つ（quick-questions.ts）。fill は入力欄に文を入れて〔　〕を選んだ状態にし、send はすぐ送る。
//   props.interviewId（開いている面談記録）を質問と一緒に API へ渡す（台本の答えがあれば API が先頭に添える。保存は打った文だけ）。
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { isOldPrepFormat } from "@/lib/interview-prep/format";
import { researchSources, type ResearchResult } from "@/lib/interview-prep/research-format";
import type { AskedQuestions, PrepSummary } from "@/lib/interview-prep/summary-format";
import { QUICK_QUESTIONS, blankRangeOf, type QuickQuestion } from "@/lib/interview-prep/quick-questions";
import InterviewPrepSummaryCards from "./InterviewPrepSummaryCards";

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
    research: ResearchResult | null;
    resumeImportedAt: string | null;
    /** T-205 step12: 材料に使った PDF のファイル名（「材料:」の表示用） */
    resumeFileName: string | null;
    resumeChars: number;
    summary: { id: string; content: string; createdAt: string } | null;
    summaryJson: PrepSummary | null;
    askedQuestions: AskedQuestions;
    messages: PrepMessage[];
  } | null;
  resume: { fileId: string; importedAt: string; fileName: string } | null;
};

/** 画面で持つ整理（会話の先頭に表示する）。json が null の部屋は文章表示（step7 以前）。 */
type SummaryView = {
  content: string;
  createdAt: string;
  careerType: string | null;
  research: ResearchResult | null;
  json: PrepSummary | null;
  asked: AskedQuestions;
};

type Props = {
  candidateId: string;
  /** T-208 step3: 開いている面談記録。台本の答えがあれば API がチャットの質問に「【台本で分かったこと】」を添える（無ければ何も付けない） */
  interviewId?: string | null;
  open: boolean;
  onClose: () => void;
  /** T-208: 台本モードの右側に埋め込む（portal・固定配置・×・広げる・Esc を使わず、親の枠いっぱいに出す）。中身は同じ */
  embedded?: boolean;
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

// 文字の読みやすさ（T-205 step3）: 本文 15px・行間 1.9 / 見出し 16px 太字・上 20px / 箇条書きの間 6px
const HEADING_CLASS = "font-bold text-[16px] mt-5 first:mt-0 mb-2";

/** 古い整理の案内。カード表示の部屋（summary_json あり）は T-208 step3 の会社ごとの振り分けの案内、文章表示の部屋はカード表示の案内 */
function OldFormatNotice({ hasCards }: { hasCards: boolean }) {
  return (
    <p className="text-[12px] text-amber-700">
      {hasCards
        ? "「作り直す」と、面談で聞くことが会社ごとに振り分けられます。"
        : "表示が新しくなりました。「作り直す」を押すとカード表示になります。"}
    </p>
  );
}

function PrepMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <p className="mb-3 last:mb-0 text-[15px] leading-[1.9]">{children}</p>,
        h1: ({ children }) => <p className={HEADING_CLASS}>{children}</p>,
        h2: ({ children }) => <p className={HEADING_CLASS}>{children}</p>,
        h3: ({ children }) => <p className={HEADING_CLASS}>{children}</p>,
        h4: ({ children }) => <p className={HEADING_CLASS}>{children}</p>,
        ul: ({ children }) => <ul className="ml-5 mb-3 space-y-1.5 list-disc [&_ul]:mt-1.5 [&_ul]:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="ml-5 mb-3 space-y-1.5 list-decimal [&_ul]:mt-1.5 [&_ul]:mb-0">{children}</ol>,
        li: ({ children }) => <li className="text-[15px] leading-[1.9]">{children}</li>,
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

/** 下調べの進み具合（SSE の researchProgress）。step7 で会社だけになった。 */
type ResearchPartProgress = "running" | "ok" | "timeout" | "error";
type ResearchProgress = { company: ResearchPartProgress };

/**
 * 整理ができるまでの表示（step8: カードは一度に出すので、途中は進み具合だけ）。
 * 「会社を調べています…」→「✓ 会社を調べました」＋「整理を作っています…」。
 */
function ProgressLines({
  researching,
  progress,
  summarizing,
}: {
  researching: boolean;
  progress: ResearchProgress | null;
  summarizing: boolean;
}) {
  const st = researching ? (progress?.company ?? "running") : progress?.company ?? null;
  return (
    <div className="text-sm py-4 space-y-1.5">
      {st === "running" || (researching && !st) ? (
        <p className="text-gray-400">会社を調べています…</p>
      ) : st === "ok" ? (
        <p className="text-gray-600">✓ 会社を調べました</p>
      ) : st === "timeout" || st === "error" ? (
        <p className="text-amber-700">会社は今回調べられませんでした</p>
      ) : null}
      {!researching && (
        <p className="text-gray-400">{summarizing ? "整理を作っています…" : "準備しています…"}</p>
      )}
    </div>
  );
}

/** 整理の末尾に出す「調べた情報の出典」（文章表示の古い部屋用。カード表示は InterviewPrepSummaryCards 内で出す）。 */
function ResearchSources({ research }: { research: ResearchResult | null }) {
  const sources = researchSources(research);
  if (sources.length === 0) return null;
  return (
    <div className="mt-6 pt-3 border-t border-gray-100 text-[11px] text-gray-500">
      <div className="font-medium mb-1">調べた情報の出典</div>
      <ul className="space-y-0.5">
        {sources.map((src) => (
          <li key={src.label} className="break-all">
            <span className="text-gray-600">{src.label}:</span>{" "}
            {src.urls.map((u, i) => (
              <span key={u}>
                {i > 0 && "、"}
                <a href={u} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  {i + 1}
                </a>
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BlinkCursor() {
  return <span className="inline-block w-[2px] h-[1em] align-text-bottom bg-gray-700 animate-pulse ml-0.5" />;
}

export default function InterviewPrepPanel({ candidateId, interviewId = null, open, onClose, embedded = false }: Props) {
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<PrepState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 整理（会話の先頭）
  const [summary, setSummary] = useState<SummaryView | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  // 整理の前の下調べ（会社のネット検索）の最中か。進み具合も持つ
  const [researching, setResearching] = useState(false);
  const [researchProgress, setResearchProgress] = useState<ResearchProgress | null>(null);
  // 下調べが終わり、整理（ツール呼び出し）が動いている最中か（SSE の summarizing）
  const [summaryGenerating, setSummaryGenerating] = useState(false);

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
  // 開いた直後の取り込みが済んだら、会話あり=一番下・会話なし=一番上に合わせる（一度だけ）
  const initialScrollRef = useRef(false);
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
        ? {
            content: data.room.summary.content,
            createdAt: data.room.summary.createdAt,
            careerType: data.room.careerType,
            research: data.room.research ?? null,
            json: data.room.summaryJson ?? null,
            asked: data.room.askedQuestions ?? {},
          }
        : null,
    );
  }, []);

  const fetchState = useCallback(async (initial = false) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/interview-prep`);
      if (!res.ok) throw new Error("状態の取得に失敗しました");
      const data = (await res.json()) as PrepState;
      if (initial) initialScrollRef.current = true;
      applyState(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "状態の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [candidateId, applyState]);

  // 開いたときに状態を取り直す（表示位置は取り込み後に決める）
  useEffect(() => {
    if (!open) return;
    setError(null);
    setPendingQuestion(null);
    setStreamAnswer("");
    stickToBottomRef.current = false;
    void fetchState(true);
  }, [open, fetchState]);

  // Esc で閉じる（埋め込み表示では閉じる操作が無い）
  useEffect(() => {
    if (!open || embedded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, embedded]);

  // 新しい文字が出るたびに下へ（CA が上へスクロールして読み返しているときは止める）
  // 開いた直後だけは、会話があれば一番下（最新）、無ければ一番上（整理の先頭）から表示する
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (initialScrollRef.current) {
      if (loading) return;
      initialScrollRef.current = false;
      const hasMessages = messages.length > 0;
      el.scrollTop = hasMessages ? el.scrollHeight : 0;
      stickToBottomRef.current = hasMessages;
      return;
    }
    if (!stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streamAnswer, pendingQuestion, sending, loading]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  // 上部バーの「整理へ移動」: 1本のスクロールの一番上（整理の先頭）へ戻る
  const scrollToSummary = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = false;
    el.scrollTo({ top: 0, behavior: "smooth" });
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
      setSummaryGenerating(false);
      setResearchProgress(null);
      // 整理は先頭に出るので、作成中は一番上を見せる
      stickToBottomRef.current = false;
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
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
              setError({ kind: "summary", message: "材料のPDF（書類タブの「面談」）が見つからないため、作り直しはできません。今の整理をそのまま使えます。" });
              await fetchState();
            }
            return;
          }
          if (res.status === 422 && body.error === "resume_unreadable") {
            setError({
              kind: "summary",
              rebuild,
              message: `材料のPDFの文字を読み取れません（読み取れたのは ${body.chars ?? 0} 字。200字以上が必要です）。`,
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
        // started を受け取った時点で新しい部屋はできている（作り直しなら古い部屋は非表示済み）。
        // 以降の失敗は新しい部屋を空のまま残し、「面談準備を作る」／再送は作り直しではなく通常の作成にする。
        let retryAsRebuild = rebuild;
        await readSse(
          res,
          () => {
            /* step8: 整理は文章で流れてこない（done で一度に受け取る） */
          },
          (payload) => {
            if (payload.started) {
              retryAsRebuild = false;
            } else if (payload.researching || payload.researchProgress) {
              setResearching(true);
              if (payload.researchProgress) setResearchProgress(payload.researchProgress as ResearchProgress);
            } else if (payload.researched) {
              // 下調べの結果（✓ 会社を調べました）は残したまま、整理の段階へ
              setResearching(false);
            } else if (payload.summarizing) {
              setResearching(false);
              setSummaryGenerating(true);
            } else if (payload.done) {
              finished = true;
              const s = payload.summary as { content: string; createdAt: string };
              const research = (payload.research as ResearchResult | null | undefined) ?? null;
              const json = (payload.summaryJson as PrepSummary | null | undefined) ?? null;
              const asked = (payload.askedQuestions as AskedQuestions | undefined) ?? {};
              const careerType = (payload.careerType as string | null) ?? null;
              setSummary({ content: s.content, createdAt: s.createdAt, careerType, research, json, asked });
              setState((prev) =>
                prev
                  ? {
                      ...prev,
                      room: {
                        id: String(payload.roomId),
                        createdAt: s.createdAt,
                        careerType,
                        research,
                        resumeImportedAt: prev.room?.resumeImportedAt ?? prev.resume?.importedAt ?? null,
                        resumeFileName: prev.room?.resumeFileName ?? prev.resume?.fileName ?? null,
                        resumeChars: prev.room?.resumeChars ?? 0,
                        summary: { id: "", content: s.content, createdAt: s.createdAt },
                        summaryJson: json,
                        askedQuestions: asked,
                        messages: [],
                      },
                    }
                  : prev,
              );
            } else if (typeof payload.error === "string") {
              setError({ kind: "summary", rebuild: retryAsRebuild, message: payload.error });
            }
          },
        );
        if (!finished) {
          setError(
            (e) => e ?? { kind: "summary", rebuild: retryAsRebuild, message: "整理の作成が途中で止まりました。再送してください。" },
          );
        }
      } catch (e) {
        setError({ kind: "summary", rebuild, message: e instanceof Error ? e.message : "整理の作成に失敗しました。" });
      } finally {
        setSummarizing(false);
        setResearching(false);
        setResearchProgress(null);
        setSummaryGenerating(false);
      }
    },
    [candidateId, summarizing, sending, fetchState],
  );

  // 「聞いた」を付ける／外す。画面を先に変え、保存に失敗したら戻す
  const toggleAsked = useCallback(
    async (index: number, asked: boolean) => {
      const prevAsked = summary?.asked ?? {};
      const optimistic: AskedQuestions = { ...prevAsked };
      if (asked) optimistic[String(index)] = { askedAt: new Date().toISOString(), userId: "" };
      else delete optimistic[String(index)];
      setSummary((s) => (s ? { ...s, asked: optimistic } : s));
      try {
        const res = await fetch(`/api/candidates/${candidateId}/interview-prep/asked`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ index, asked }),
        });
        if (!res.ok) throw new Error("save failed");
        const data = (await res.json()) as { askedQuestions: AskedQuestions };
        setSummary((s) => (s ? { ...s, asked: data.askedQuestions } : s));
      } catch {
        setSummary((s) => (s ? { ...s, asked: prevAsked } : s));
      }
    },
    [candidateId, summary?.asked],
  );

  const runChat = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || sending || summarizing) return;
      setError(null);
      setSending(true);
      setPendingQuestion(q);
      setStreamAnswer("");
      stickToBottomRef.current = true; // 送った瞬間は一番下へ
      try {
        const res = await fetch(`/api/candidates/${candidateId}/interview-prep/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // T-208 step3: 開いている面談記録を渡す（台本の答えがあれば API が質問の先頭に添える。保存は打った文だけ）
          body: JSON.stringify({ content: q, interviewId }),
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
    [candidateId, interviewId, sending, summarizing, fetchState],
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
    const ok = window.confirm("今の整理と会話を片付けて、新しく作り直します。よろしいですか？");
    if (!ok) return;
    void runSummary(true);
  };

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, TEXTAREA_MIN_PX), TEXTAREA_MAX_PX)}px`;
  };

  // T-208 step3（付録G）: 「よく使う質問」のボタン。fill は入力欄に文を入れて〔　〕を選んだ状態にする（値が描画されてから選択する）。send はすぐ送る
  const pendingSelectRef = useRef<{ start: number; end: number } | null>(null);
  useEffect(() => {
    const range = pendingSelectRef.current;
    const el = textareaRef.current;
    if (!range || !el) return;
    pendingSelectRef.current = null;
    resizeTextarea();
    el.focus();
    el.setSelectionRange(range.start, range.end);
  }, [input]);
  const handleQuickQuestion = (q: QuickQuestion) => {
    if (summarizing || sending) return;
    if (q.kind === "send") {
      void runChat(q.text);
      return;
    }
    pendingSelectRef.current = blankRangeOf(q.text);
    setInput(q.text);
  };

  if (!open || !mounted) return null;

  const candidateName = state?.candidate.name ?? "";
  const importedAt = state?.room?.resumeImportedAt ?? state?.resume?.importedAt ?? null;
  // T-205 step12: 材料は「面談」フォルダの最新 PDF。部屋があればその部屋で使ったファイル、無ければ今見つかるファイル
  const materialName = state?.room?.resumeFileName ?? state?.resume?.fileName ?? null;
  const hasRoom = !!summary;
  const noResume = !state?.room && !state?.resume;
  const busy = summarizing || sending;
  const hasConversation = messages.length > 0 || !!pendingQuestion;
  // 上部のバー（整理＋経歴の型＋「整理へ移動」）は、整理がある・作成中のとき常に出す（step11）
  const showSummaryBar = hasRoom || summarizing;
  // step8: summary_json が無い部屋は文章表示のまま（作り直すとカード表示）。日時の判定も残す
  const oldFormat = !summarizing && !!summary && (!summary.json || isOldPrepFormat(summary.createdAt));
  const summaryLabel = `整理${summary && !summarizing ? `（${formatDate(summary.createdAt)}）` : summarizing ? "（作成中）" : ""}`;
  const careerBadge =
    summary?.careerType && !summarizing ? (
      <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
        {summary.careerType}
      </span>
    ) : null;
  const width = wide ? "95vw" : "clamp(720px, 60vw, calc(100vw - 48px))";

  const panel = (
    <div
      role={embedded ? undefined : "dialog"}
      aria-label="面談準備"
      className={
        embedded
          ? "relative w-full h-full min-h-0 bg-white flex flex-col"
          : "fixed top-0 right-0 h-screen bg-white border-l border-gray-200 shadow-2xl z-[70] flex flex-col"
      }
      style={embedded ? undefined : { width, maxWidth: "calc(100vw - 48px)" }}
    >
      {/* ヘッダー */}
      <div className="flex items-start gap-3 px-5 py-3 border-b border-gray-200 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-gray-900 truncate">
            面談準備｜{candidateName ? `${candidateName} さん` : ""}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            材料: {materialName ? `${materialName}${importedAt ? `（${formatDate(importedAt)}）` : ""}` : "なし"}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!embedded && (
            <button
              type="button"
              onClick={toggleWide}
              className="px-2.5 py-1 rounded-md text-[12px] border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              {wide ? "元の幅" : "広げる"}
            </button>
          )}
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
          {!embedded && (
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              className="w-8 h-8 rounded-md text-gray-500 hover:bg-gray-100 text-lg leading-none"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* 上部のバー（スクロールしない。「整理へ移動」で下の1本のスクロールを先頭へ戻す） */}
      {showSummaryBar && (
        <div className="border-b border-gray-200 bg-gray-50/60 shrink-0">
          <div className="flex items-center gap-2 px-5 py-2">
            <span className="text-[13px] font-medium text-gray-700 shrink-0">{summaryLabel}</span>
            {careerBadge}
            {oldFormat && (
              <span className="min-w-0">
                <OldFormatNotice hasCards={!!summary?.json} />
              </span>
            )}
            <button
              type="button"
              onClick={scrollToSummary}
              className="ml-auto shrink-0 text-[12px] text-blue-600 hover:underline"
            >
              整理へ移動
            </button>
          </div>
        </div>
      )}

      {/* 1本のスクロール（整理＝先頭のメッセージ → 会話） */}
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
                <p className="text-base font-medium text-gray-700 mb-2">材料のPDFが見つかりません</p>
                <p className="text-sm text-gray-500">
                  書類タブの「面談」にPDF（マイナビレジュメなど）が入ると使えるようになります。
                </p>
                {error && <p className="text-sm text-red-600 mt-4">{error.message}</p>}
              </div>
            ) : (
              <div className="text-center py-16">
                <p className="text-lg font-medium text-gray-800 mb-2">面談の準備を始めましょう</p>
                <p className="text-sm text-gray-500 mb-6">
                  「面談」フォルダのPDF（マイナビレジュメなど）と、勤めた会社のネット検索を使い、どんな学校でどんな会社に就職し何をしてきた人かと、面談での質問のしかたを整理します。
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
              {/* 整理は会話の先頭のメッセージ（会話の有無に関係なく常にここ。高さの上限なし） */}
              <div className={hasConversation ? "pb-6 border-b border-gray-100" : undefined}>
                <div className="text-gray-800">
                  {summarizing ? (
                    <>
                      <ProgressLines researching={researching} progress={researchProgress} summarizing={summaryGenerating} />
                      <BlinkCursor />
                    </>
                  ) : summary?.json ? (
                    <InterviewPrepSummaryCards
                      summary={summary.json}
                      research={summary.research}
                      asked={summary.asked}
                      onToggleAsked={(i, a) => void toggleAsked(i, a)}
                      disabled={busy}
                    />
                  ) : (
                    <>
                      <PrepMarkdown text={summary?.content ?? ""} />
                      <ResearchSources research={summary?.research ?? null} />
                    </>
                  )}
                </div>
                {!summarizing && !hasConversation && (
                  <p className="mt-8 text-[12px] text-gray-400">
                    整理を読んで、気になることを下の入力欄から質問してください。
                  </p>
                )}
              </div>
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] bg-gray-100 rounded-2xl px-4 py-2.5 text-sm text-gray-900 whitespace-pre-wrap">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="text-gray-800">
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
                <div className="text-gray-800">
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
            {/* T-208 step3（付録G）: よく使う質問（横のパネルでも台本モードの右側でも同じ。送信中・整理中は押せない） */}
            <div className="flex flex-wrap gap-1.5 mb-2" aria-label="よく使う質問">
              {QUICK_QUESTIONS.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  onClick={() => handleQuickQuestion(q)}
                  disabled={busy}
                  title={q.kind === "send" ? "押すとすぐ送ります" : "入力欄に入れます（〔　〕を打ち替えてから送る）"}
                  className="px-2.5 py-1 rounded-full text-[12px] border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  {q.label}
                </button>
              ))}
            </div>
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

  if (embedded) return panel;
  return createPortal(panel, document.body);
}
