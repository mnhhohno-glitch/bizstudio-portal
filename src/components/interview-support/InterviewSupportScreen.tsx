"use client";

// T-183: 面談サポート画面。リアルタイム文字起こし＋AI解説。
// - 文字起こしは useSpeechTranscription（Web Speech API）に分離。将来の外部API差し替え境界。
// - 解説は /api/interview-support/explain（SSE）。押下の瞬間にカード枠を即描画し、受信文字を逐次流し込む。
// - ログは sessionStorage に逐次退避（保存失敗時の最後の砦として Phase 2 以降も継続）。
// - Phase 2: DB保存。「開始」でクライアント生成の sessionId を確定し、認識中は1分ごと＋停止時＋
//   解説完了直後に同一 sessionId へ upsert（冪等）。失敗しても UI は止めず次回保存でリトライ。
// - Phase 3: 自動検知。認識中は30秒ごとに新規確定発話を /api/interview-support/auto-scan へ送り、
//   用語（時系列に積む）/ 業務内容（職務ごと更新型）/ 転職理由（1枚更新型）のカードを自動生成する。
//   自動フローのエラーは画面に出さず沈黙（失敗区間は次回スキャンでリトライ）。

import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { useSpeechTranscription, type TranscriptEntry } from "./useSpeechTranscription";
import TranscriptLog from "./TranscriptLog";
import ExplainCards, {
  type ExplainCard,
  type AutoJobCard,
  type AutoReasonCard,
} from "./ExplainCards";

// 「直近30秒」の切り出し幅(ms)。実測を見て調整する設定値。
const RECENT_WINDOW_MS = 30_000;
// 解説カードに表示する元テキスト抜粋の長さ。
const EXCERPT_CHARS = 30;
// Phase 2: DB定期保存の間隔(ms)。認識中はこの間隔で upsert する。
const AUTOSAVE_INTERVAL_MS = 60_000;
// Phase 3: 自動検知スキャンの間隔(ms)。実測を見て調整する設定値。
const AUTO_SCAN_INTERVAL_MS = 30_000;
// Phase 3: 新規発話がこの文字数未満ならスキャンをスキップ（無言・相槌のみの区間は呼ばない＝コストゼロ）。
const AUTO_SCAN_MIN_CHARS = 20;
// Phase 3: 再解説防止のためAPIに渡す解説済み用語の保持上限（直近N件）。
const EXPLAINED_TERMS_MAX = 30;
// Phase 3: 更新型カードのハイライト表示時間(ms)。
const AUTO_CARD_HIGHLIGHT_MS = 1500;

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

  /* ---- Phase 3: 自動検知の更新型カード（業務内容=職務ごと / 転職理由=1枚） ---- */
  const [jobCards, setJobCards] = useState<AutoJobCard[]>([]);
  const [reasonCard, setReasonCard] = useState<AutoReasonCard | null>(null);

  /* ---- Phase 2: DBへの自動保存 ---- */
  // 「開始」初回押下で確定するセッション識別子。以後の保存はすべてこのIDへの upsert（冪等）。
  const dbSessionRef = useRef<{ id: string; startedAt: number } | null>(null);
  const endedAtRef = useRef<number | null>(null);
  // interval / beforeunload から常に最新の entries・cards を読むための鏡（stale closure 回避）。
  // render 中の ref 書き込みは React Compiler 系 lint に反するため effect で退避する。
  const latestRef = useRef({ entries, cards, jobCards, reasonCard });
  useEffect(() => {
    latestRef.current = { entries, cards, jobCards, reasonCard };
  }, [entries, cards, jobCards, reasonCard]);
  const saveFailedRef = useRef(false);

  const saveSession = useCallback(
    (opts?: { keepalive?: boolean }) => {
      const session = dbSessionRef.current;
      if (!session) return;
      const { entries: curEntries, cards: curCards, jobCards: curJobs, reasonCard: curReason } = latestRef.current;
      const doneCards = curCards.filter((c) => c.status === "done");
      if (curEntries.length === 0 && doneCards.length === 0) return;
      // Phase 3: 更新型カード（業務内容・転職理由）は保存時点の最新版のみを乗せる（更新のたびに履歴を積まない）。
      const explanations = [
        // 手動解説＋自動用語カード。streaming/error は保存しない。
        ...doneCards.map((c) => ({
          t: new Date(c.createdAt).toISOString(),
          mode: c.mode,
          sourceText: c.source,
          resultText: c.text,
        })),
        ...curJobs.map((j) => ({
          t: new Date(j.updatedAt).toISOString(),
          mode: "auto-job" as const,
          sourceText: j.title,
          resultText: j.text,
        })),
        ...(curReason
          ? [{
              t: new Date(curReason.updatedAt).toISOString(),
              mode: "auto-reason" as const,
              sourceText: "転職理由",
              resultText: curReason.text,
            }]
          : []),
      ].sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
      const payload = {
        sessionId: session.id,
        startedAt: new Date(session.startedAt).toISOString(),
        endedAt: endedAtRef.current ? new Date(endedAtRef.current).toISOString() : null,
        transcript: curEntries.map((e) => ({ t: new Date(e.timestamp).toISOString(), text: e.text })),
        explanations,
      };
      void fetch(`/api/interview-support/${interviewId}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: opts?.keepalive ?? false,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`save failed: ${res.status}`);
          saveFailedRef.current = false;
        })
        .catch(() => {
          // 失敗してもUIは止めない（sessionStorage 退避は継続・次の保存でリトライ）。連続失敗の初回だけ軽く通知。
          if (!saveFailedRef.current) {
            saveFailedRef.current = true;
            toast.warning("記録の自動保存に失敗しました。次回の保存で再試行します");
          }
        });
    },
    [interviewId]
  );

  // 認識中は1分ごとに定期保存。
  useEffect(() => {
    if (!listening) return;
    const timer = setInterval(() => saveSession(), AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [listening, saveSession]);

  const handleStart = useCallback(() => {
    if (!dbSessionRef.current) {
      dbSessionRef.current = { id: crypto.randomUUID(), startedAt: Date.now() };
    }
    // 停止→再開は同一セッションの続きとして扱う（「終了済み」を取り消す）。
    endedAtRef.current = null;
    start();
  }, [start]);

  const handleStop = useCallback(() => {
    stop();
    endedAtRef.current = Date.now();
    saveSession();
  }, [stop, saveSession]);

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
      // Phase 2: 離脱直前のベストエフォート保存（keepalive）。離脱警告そのものは従来どおり維持。
      saveSession({ keepalive: true });
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [entries.length, saveSession]);

  /* ---- AI解説（SSEストリーミング） ---- */
  const runExplain = useCallback(async (mode: "recent" | "selection", text: string) => {
    cardSeqRef.current += 1;
    const cardId = `c-${Date.now()}-${cardSeqRef.current}`;
    const excerpt = text.replace(/\s+/g, " ").slice(0, EXCERPT_CHARS);
    // 押下の瞬間にカード枠＋「解説中…」を即描画（通信開始前）。
    setCards((prev) => [
      { id: cardId, mode, excerpt, source: text, text: "", status: "streaming", createdAt: Date.now() },
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

  /* ---- Phase 3: 自動検知（30秒ごとに新規発話をスキャンし、用語/業務内容/転職理由カードを自動生成） ---- */
  // スキャン済み entries 件数。API成功時のみ進める（失敗時は同じ発話を次回リトライ）。
  const scannedCountRef = useRef(0);
  // 多重実行防止（API応答が間隔より遅い場合に重ねて呼ばない）。
  const scanInFlightRef = useRef(false);
  // 再解説防止のための解説済み用語リスト（直近 EXPLAINED_TERMS_MAX 件）。
  const explainedTermsRef = useRef<string[]>([]);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runAutoScan = useCallback(async () => {
    if (scanInFlightRef.current) return;
    const { entries: curEntries, jobCards: curJobs, reasonCard: curReason } = latestRef.current;
    const newEntries = curEntries.slice(scannedCountRef.current);
    const text = newEntries.map((e) => e.text).join("\n");
    if (text.length < AUTO_SCAN_MIN_CHARS) return; // 無言・相槌のみの区間は呼ばない
    const scannedCount = curEntries.length;
    scanInFlightRef.current = true;
    try {
      const res = await fetch("/api/interview-support/auto-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          explainedTerms: explainedTermsRef.current,
          existingJobs: curJobs.map((j) => ({ key: j.key, title: j.title, text: j.text })),
          existingReason: curReason?.text ?? null,
        }),
      });
      if (!res.ok) return; // 自動フローはエラーを画面に出さない（次回スキャンで回復）
      const data = (await res.json()) as {
        terms?: Array<{ term?: string; text?: string }>;
        jobs?: Array<{ key?: string; title?: string; text?: string }>;
        reason?: { text?: string } | null;
      };
      scannedCountRef.current = scannedCount;

      let applied = false;
      const now = Date.now();

      // ①用語: 時系列エリアに完成カードとして積む。解説済みは再解説しない。
      const newTermCards: ExplainCard[] = [];
      for (const t of (data.terms ?? []).slice(0, 2)) {
        if (!t?.term || !t?.text) continue;
        if (explainedTermsRef.current.includes(t.term)) continue;
        explainedTermsRef.current = [...explainedTermsRef.current, t.term].slice(-EXPLAINED_TERMS_MAX);
        cardSeqRef.current += 1;
        newTermCards.push({
          id: `c-${now}-${cardSeqRef.current}`,
          mode: "auto-term",
          excerpt: t.term,
          source: t.term,
          text: t.text,
          status: "done",
          createdAt: now,
        });
      }
      if (newTermCards.length > 0) {
        applied = true;
        setCards((prev) => [...newTermCards, ...prev]);
      }

      // ②業務内容: key が既存なら同カードを更新して育てる。新規 key は固定エリアに追加。
      const jobs = (data.jobs ?? []).flatMap((j) =>
        j?.key && j?.text ? [{ key: j.key, title: j.title ?? "", text: j.text }] : []
      );
      if (jobs.length > 0) {
        applied = true;
        setJobCards((prev) => {
          const next = [...prev];
          for (const j of jobs) {
            const idx = next.findIndex((c) => c.key === j.key);
            if (idx >= 0) {
              next[idx] = { ...next[idx], title: j.title || next[idx].title, text: j.text, updatedAt: now, highlight: true };
            } else {
              next.push({ key: j.key, title: j.title || "業務内容", text: j.text, updatedAt: now, highlight: true });
            }
          }
          return next;
        });
      }

      // ③転職理由: 全体で1枚の更新型（統合済みの最新版で置き換え）。
      if (data.reason?.text) {
        applied = true;
        setReasonCard({ text: data.reason.text, updatedAt: now, highlight: true });
      }

      if (applied) {
        // 更新ハイライトを一定時間で消す（transition で背景色が戻る）。
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => {
          setJobCards((prev) => (prev.some((c) => c.highlight) ? prev.map((c) => ({ ...c, highlight: false })) : prev));
          setReasonCard((prev) => (prev?.highlight ? { ...prev, highlight: false } : prev));
        }, AUTO_CARD_HIGHLIGHT_MS);
        saveSession();
      }
    } catch {
      // 通信失敗も沈黙（scannedCount を進めていないので次回同じ発話でリトライ）
    } finally {
      scanInFlightRef.current = false;
    }
  }, [saveSession]);

  // 認識中のみ30秒間隔で自動スキャン。「停止」中は止まる。
  useEffect(() => {
    if (!listening) return;
    const timer = setInterval(() => {
      void runAutoScan();
    }, AUTO_SCAN_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [listening, runAutoScan]);

  // アンマウント時にハイライト解除タイマーを破棄。
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  // Phase 2: 解説カードの完成直後にも保存する（1分待たずに解説を確実に残す）。
  // 完成数を描画側で数えて effect で反応する（setState updater 内で数えない）。
  const doneCardCount = cards.filter((c) => c.status === "done").length;
  useEffect(() => {
    if (doneCardCount === 0) return;
    saveSession();
  }, [doneCardCount, saveSession]);

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
              onClick={handleStop}
              className="rounded-lg border border-red-200 bg-red-50 px-6 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 cursor-pointer"
            >
              ■ 停止
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStart}
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

        {/* 右: 上段=固定エリア（業務内容・転職理由）＋下段=時系列カード（新しい順） */}
        <div className="w-[380px] shrink-0 min-h-0">
          <ExplainCards cards={cards} jobCards={jobCards} reasonCard={reasonCard} />
        </div>
      </div>
    </div>
  );
}
