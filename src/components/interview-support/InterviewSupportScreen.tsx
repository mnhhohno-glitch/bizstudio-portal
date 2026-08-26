"use client";

// T-183: 面談サポート画面（Phase 1）。リアルタイム文字起こし＋AI解説。
// - 文字起こしは useSpeechTranscription（Web Speech API）に分離。将来の外部API差し替え境界。
// - 解説は /api/interview-support/explain（SSE）。押下の瞬間にカード枠を即描画し、受信文字を逐次流し込む。
// - ログは sessionStorage に逐次退避（Phase 2 のDB保存の前段）。DB保存・振り返り表示は Phase 2。

import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { useSpeechTranscription, type TranscriptEntry } from "./useSpeechTranscription";
import TranscriptLog from "./TranscriptLog";
import ExplainCards, { type ExplainCard } from "./ExplainCards";

// 「直近30秒」の切り出し幅(ms)。実測を見て調整する設定値。
const RECENT_WINDOW_MS = 30_000;
// 解説カードに表示する元テキスト抜粋の長さ。
const EXCERPT_CHARS = 30;

type InterviewInfo = {
  candidateName: string;
  interviewDate: string | null;
  interviewCount: number | null;
};

function sessionStorageKey(interviewId: string): string {
  return `interview-support-log:${interviewId}`;
}

export default function InterviewSupportScreen({ interviewId }: { interviewId: string }) {
  const { entries, interimText, listening, supported, start, stop, restore } =
    useSpeechTranscription();

  const [info, setInfo] = useState<InterviewInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const [cards, setCards] = useState<ExplainCard[]>([]);
  const cardSeqRef = useRef(0);

  /* ---- 面談情報の取得（既存 GET /api/interviews/[id] を流用） ---- */
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const res = await fetch(`/api/interviews/${interviewId}`);
        if (!res.ok) {
          if (!aborted) setInfoError(res.status === 404 ? "面談レコードが見つかりません" : "面談情報の取得に失敗しました");
          return;
        }
        const data = await res.json();
        if (aborted) return;
        setInfo({
          candidateName: data.record?.candidate?.name ?? "(不明)",
          interviewDate: data.record?.interviewDate ?? null,
          interviewCount: data.record?.interviewCount ?? null,
        });
      } catch {
        if (!aborted) setInfoError("面談情報の取得に失敗しました");
      }
    })();
    return () => {
      aborted = true;
    };
  }, [interviewId]);

  /* ---- sessionStorage への逐次退避と復元（Phase 2 のDB保存の前段） ---- */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(sessionStorageKey(interviewId));
      if (raw) {
        const saved = JSON.parse(raw) as TranscriptEntry[];
        if (Array.isArray(saved) && saved.length > 0) restore(saved);
      }
    } catch {
      // 退避データが壊れていても本体は動かす
    }
  }, [interviewId, restore]);

  useEffect(() => {
    if (entries.length === 0) return;
    try {
      sessionStorage.setItem(sessionStorageKey(interviewId), JSON.stringify(entries));
    } catch {
      // 容量超過等は無視（表示は維持）
    }
  }, [entries, interviewId]);

  /* ---- 離脱警告（ログがある状態でのタブ閉じ・リロード） ---- */
  useEffect(() => {
    if (entries.length === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [entries.length]);

  /* ---- AI解説（SSEストリーミング） ---- */
  const runExplain = useCallback(async (mode: "recent" | "selection", text: string) => {
    cardSeqRef.current += 1;
    const cardId = `c-${Date.now()}-${cardSeqRef.current}`;
    const excerpt = text.replace(/\s+/g, " ").slice(0, EXCERPT_CHARS);
    // 押下の瞬間にカード枠＋「解説中…」を即描画（通信開始前）。
    setCards((prev) => [
      { id: cardId, mode, excerpt, text: "", status: "streaming", createdAt: Date.now() },
      ...prev,
    ]);

    const patchCard = (patch: Partial<ExplainCard>) => {
      setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, ...patch } : c)));
    };
    const appendText = (chunk: string) => {
      setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, text: c.text + chunk } : c)));
    };

    try {
      const res = await fetch("/api/interview-support/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, text }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        patchCard({ status: "error", text: data?.error ?? "解説の取得に失敗しました" });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let failed = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const ev of events) {
          const line = ev.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const payload = JSON.parse(line.slice(6)) as { text?: string; done?: boolean; error?: string };
            if (payload.text) appendText(payload.text);
            if (payload.error) {
              failed = true;
              patchCard({ status: "error", text: payload.error });
            }
          } catch {
            // 不正なイベントはスキップ
          }
        }
      }
      if (!failed) patchCard({ status: "done" });
    } catch {
      patchCard({ status: "error", text: "通信に失敗しました。もう一度試してください。" });
    }
  }, []);

  const explainRecent = useCallback(() => {
    const since = Date.now() - RECENT_WINDOW_MS;
    const recent = entries.filter((e) => e.timestamp >= since);
    const text = recent.map((e) => e.text).join("\n");
    if (!text.trim()) {
      toast.info("直近30秒の発話がありません");
      return;
    }
    runExplain("recent", text);
  }, [entries, runExplain]);

  const explainSelection = useCallback(() => {
    if (!selectionText.trim()) return;
    runExplain("selection", selectionText);
  }, [selectionText, runExplain]);

  const interviewDateLabel = info?.interviewDate
    ? new Date(info.interviewDate).toLocaleDateString("ja-JP")
    : null;

  return (
    <div className="flex flex-col gap-3" style={{ height: "calc(100vh - 120px)" }}>
      <Toaster position="top-center" richColors />
      {/* ============ 上部バー ============ */}
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="text-base font-semibold text-gray-900">面談サポート</span>
          {infoError ? (
            <span className="text-sm text-red-600">{infoError}</span>
          ) : (
            <span className="truncate text-sm text-gray-600">
              {info ? (
                <>
                  {info.candidateName}
                  {info.interviewCount ? ` / 面談 #${info.interviewCount}` : ""}
                  {interviewDateLabel ? ` / ${interviewDateLabel}` : ""}
                </>
              ) : (
                "読み込み中..."
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                listening ? "bg-green-500 animate-pulse" : "bg-gray-300"
              }`}
            />
            <span className={listening ? "text-green-700" : "text-gray-500"}>
              {listening ? "認識中" : "停止中"}
            </span>
          </span>
          {listening ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-lg border border-red-200 bg-red-50 px-6 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 cursor-pointer"
            >
              ■ 停止
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={!supported}
              className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              ● 開始
            </button>
          )}
        </div>
      </div>

      {!supported && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          このブラウザは音声認識に対応していません。PC の Chrome でお使いください。
        </div>
      )}

      {/* ============ 中央ログ＋右カラム ============ */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* 左: 文字起こしログ＋解説ボタン */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <TranscriptLog
            entries={entries}
            interimText={interimText}
            listening={listening}
            onSelectionChange={setSelectionText}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={explainRecent}
              className="flex-1 rounded-lg bg-blue-600 px-6 py-3.5 text-base font-semibold text-white shadow-sm hover:bg-blue-700 cursor-pointer"
            >
              直近30秒を解説
            </button>
            {selectionText && (
              <button
                type="button"
                onClick={explainSelection}
                className="flex-1 rounded-lg bg-amber-500 px-6 py-3.5 text-base font-semibold text-white shadow-sm hover:bg-amber-600 cursor-pointer"
              >
                選択部分を解説
              </button>
            )}
          </div>
        </div>

        {/* 右: 解説カード（新しい順） */}
        <div className="w-[380px] shrink-0 min-h-0">
          <ExplainCards cards={cards} />
        </div>
      </div>
    </div>
  );
}
