"use client";

// T-183: 面談サポート画面。リアルタイム文字起こし＋AI解説。
// - 文字起こしは useSpeechTranscription（Web Speech API）に分離。将来の外部API差し替え境界。
// - 解説は /api/interview-support/explain（SSE）。押下の瞬間にカード枠を即描画し、受信文字を逐次流し込む。
// - ログは sessionStorage に逐次退避（保存失敗時の最後の砦として Phase 2 以降も継続）。
// - Phase 2: DB保存。「開始」でクライアント生成の sessionId を確定し、認識中は1分ごと＋停止時＋
//   解説完了直後に同一 sessionId へ upsert（冪等）。失敗しても UI は止めず次回保存でリトライ。
// - Phase 3: 自動検知。新規確定発話を /api/interview-support/auto-scan へ送り、
//   用語（時系列に積む）/ 業務内容（職務ごと更新型）/ 転職理由（1枚更新型）のカードを自動生成する。
//   自動フローのエラーは画面に出さず沈黙（失敗区間は次回スキャンでリトライ）。
// - Phase 4: 文字起こしエンジンを Deepgram（useDeepgramTranscription）に差し替え。起動時に stt-token API で
//   利用可否を判定し、使えなければ Chrome 内蔵（useSpeechTranscription）へ自動フォールバック。
//   自動検知は30秒タイマーをやめ、発話確定のたびに起動するイベント駆動（連続実行は最低5秒空ける）。
// - Phase 5: 事前情報（キャリアシート等）。起動時に prior-info API で取得して上部バーに表示し、
//   auto-scan に毎回同じ priorInfoText を添える（byte一致で prompt cache に乗る）。カードは
//   questions（確認ポイント）を持つ。
// - Phase 6: 事前情報は裏方専用に変更（実面談テストで、事前情報から作った下書きカードがCAの
//   「シート照合」を誘発し会話への集中が崩れたため）。開始時の下書き生成（bootstrap）と
//   source ラベルを廃止し、画面は常に白紙から会話ベースで積み上げる。あわせて事前情報由来の
//   固有名詞リスト（keyterms）を Deepgram の Keyterm Prompting に渡し、認識精度を底上げする。
// - Phase 7: (1) 漏えい修正 = auto-scan へシート抽出テキスト（priorInfoText）を送るのをやめ、
//   keyterms（固有名詞リスト）だけを送る（指示文の禁止では軽量モデルが先出しを守り切れなかったため、
//   構造的に漏えい不能にする）。(2) ログコピー（時刻・話者付き全文）。(3) 話者識別 = Deepgram の
//   diarize。最初に発話した話者=CA・2人目=求職者の自動割り当て＋「話者入れ替え」ボタンで反転。
//   保存 transcript の各エントリに speaker（解決済み表示名）を追加（Json相乗り・テーブル変更なし）。
//   あわせて auto-scan の連続失敗を赤字で出す（静かに止まったままにしない）＋fetch にタイムアウト
//   （応答が返らないと scanInFlight が立ちっぱなしで以後のスキャンが全部止まる経路を塞ぐ）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { useSpeechTranscription, type TranscriptEntry } from "./useSpeechTranscription";
import { useDeepgramTranscription } from "./useDeepgramTranscription";
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
// Phase 4: 自動検知はイベント駆動（発話確定ごと）。連続実行の暴走防止として、
// 直前のスキャン完了からこの時間(ms)は次のスキャンを待つ（待ち中に確定した発話はまとめて次回に送る）。
const AUTO_SCAN_COOLDOWN_MS = 5_000;
// Phase 3: 新規発話がこの文字数未満ならスキャンをスキップ（無言・相槌のみの区間は呼ばない＝コストゼロ）。
const AUTO_SCAN_MIN_CHARS = 20;
// Phase 3: 再解説防止のためAPIに渡す解説済み用語の保持上限（直近N件）。
const EXPLAINED_TERMS_MAX = 30;
// Phase 3: 更新型カードのハイライト表示時間(ms)。
const AUTO_CARD_HIGHLIGHT_MS = 1500;
// Phase 7: auto-scan がこの回数連続で失敗したら上部バーに赤字を出す（成功で消える）。
const AUTO_SCAN_FAIL_THRESHOLD = 3;
// Phase 7: auto-scan fetch のタイムアウト(ms)。応答が永久に返らないと scanInFlight が立ちっぱなしで
// 以後のスキャンが全部止まるため、必ず打ち切る。
const AUTO_SCAN_TIMEOUT_MS = 30_000;

function formatLogTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ja-JP", { hour12: false });
}

type InterviewInfo = {
  candidateName: string;
  interviewDate: string | null;
  interviewCount: number | null;
};

/* ---- Phase 5: 事前情報（キャリアシート等）。Phase 6 から裏方専用（AIの読み取り補正＋認識キーターム） ---- */
type PriorCandidateFile = { id: string; fileName: string };
type PriorInfoState =
  // loading: prior-info API 応答待ち / none: 該当ファイルなし or 抽出不可 / off: ユーザーが「使わない」を選択
  | { status: "loading" }
  | { status: "none"; candidates: PriorCandidateFile[] }
  | { status: "off"; candidates: PriorCandidateFile[] }
  | { status: "ready"; fileId: string; fileName: string; text: string; keyterms: string[]; candidates: PriorCandidateFile[] };

function sessionStorageKey(interviewId: string): string {
  return `interview-support-log:${interviewId}`;
}

export default function InterviewSupportScreen({ interviewId }: { interviewId: string }) {
  /* ---- Phase 4: 文字起こしエンジンの切替（Deepgram / Chrome内蔵） ---- */
  // フックは条件呼び出しできないため両方をマウントし、engine で使う側を選ぶ（使わない側は start しない限り不活性）。
  const speech = useSpeechTranscription();
  const deepgram = useDeepgramTranscription();
  // null = 判定中（stt-token API の応答待ち。判定が済むまで「開始」は押せない）。
  const [engine, setEngine] = useState<"deepgram" | "browser" | null>(null);
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const res = await fetch("/api/interview-support/stt-token", { method: "POST" });
        const data = res.ok ? ((await res.json()) as { available?: boolean }) : null;
        if (!aborted) setEngine(data?.available ? "deepgram" : "browser");
      } catch {
        if (!aborted) setEngine("browser");
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);
  const active = engine === "deepgram" ? deepgram : speech;
  const { entries, interimText, listening, supported, start, stop, restore, receiving, engineError } = active;

  const [info, setInfo] = useState<InterviewInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const [cards, setCards] = useState<ExplainCard[]>([]);
  const cardSeqRef = useRef(0);

  /* ---- Phase 3: 自動検知の更新型カード（業務内容=職務ごと / 転職理由=1枚） ---- */
  const [jobCards, setJobCards] = useState<AutoJobCard[]>([]);
  const [reasonCard, setReasonCard] = useState<AutoReasonCard | null>(null);

  /* ---- Phase 7: 話者識別（Deepgram diarize）の番号→表示名割り当て ---- */
  // 面談はCAの挨拶から始まる運用のため、最初に発話した話者=CA・2人目=求職者。3人目以降は「話者3」等。
  // 「話者入れ替え」でCA/求職者のラベルを反転できる（既存ログの表示・以後の保存にも効く）。
  const [speakersSwapped, setSpeakersSwapped] = useState(false);
  const speakerLabels = useMemo(() => {
    const order: number[] = [];
    for (const e of entries) {
      if (e.speaker !== undefined && !order.includes(e.speaker)) order.push(e.speaker);
    }
    const map = new Map<number, string>();
    order.forEach((speaker, idx) => {
      const label =
        idx === 0 ? (speakersSwapped ? "求職者" : "CA")
        : idx === 1 ? (speakersSwapped ? "CA" : "求職者")
        : `話者${idx + 1}`;
      map.set(speaker, label);
    });
    return map;
  }, [entries, speakersSwapped]);
  /** 1発話をログ1行のテキストにする（話者ラベル付き。コピー・AI送信・保存で共通の解決関数）。 */
  const labelOf = useCallback(
    (e: TranscriptEntry, labels: Map<number, string>): string | undefined =>
      e.speaker !== undefined ? labels.get(e.speaker) : undefined,
    []
  );

  /* ---- Phase 5: 事前情報（キャリアシート等）の取得と選択 ---- */
  const [priorInfo, setPriorInfo] = useState<PriorInfoState>({ status: "loading" });
  // Phase 7: auto-scan から常に最新の固有名詞リストを読むための鏡（"ready" 以外は空）。
  // シート抽出テキスト（priorInfo.text）は auto-scan へは送らない（漏えい修正。表示・keyterm 抽出元として保持のみ）。
  const priorKeytermsRef = useRef<string[]>([]);
  useEffect(() => {
    priorKeytermsRef.current = priorInfo.status === "ready" ? priorInfo.keyterms : [];
  }, [priorInfo]);
  // 「開始」初回押下でセッションが動き出したら事前情報の切り替えを固定する
  // （途中で差し替えると下書きと以後のスキャン前提がずれるため）。
  const [sessionStarted, setSessionStarted] = useState(false);

  const loadPriorInfo = useCallback(
    async (fileId?: string) => {
      setPriorInfo({ status: "loading" });
      try {
        const url = `/api/interview-support/${interviewId}/prior-info${fileId ? `?fileId=${encodeURIComponent(fileId)}` : ""}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as {
          available?: boolean;
          fileId?: string;
          fileName?: string;
          text?: string;
          keyterms?: string[];
          candidates?: PriorCandidateFile[];
        };
        const candidates = Array.isArray(data.candidates) ? data.candidates : [];
        if (data.available && data.fileId && data.fileName && data.text) {
          setPriorInfo({
            status: "ready",
            fileId: data.fileId,
            fileName: data.fileName,
            text: data.text,
            keyterms: Array.isArray(data.keyterms) ? data.keyterms.filter((t): t is string => typeof t === "string") : [],
            candidates,
          });
        } else {
          setPriorInfo({ status: "none", candidates });
        }
      } catch {
        // 事前情報が無くても本体は動く。失敗は「なし」として静かに続行。
        setPriorInfo({ status: "none", candidates: [] });
      }
    },
    [interviewId]
  );

  useEffect(() => {
    void loadPriorInfo();
  }, [loadPriorInfo]);

  // Phase 6: 事前情報由来の固有名詞を Deepgram の Keyterm Prompting へ渡す。
  // ref 保持なので反映は次の WebSocket 接続から（取得完了前に「開始」した場合も再接続時に効く）。
  const { setKeyterms } = deepgram;
  useEffect(() => {
    setKeyterms(priorInfo.status === "ready" ? priorInfo.keyterms : []);
  }, [priorInfo, setKeyterms]);

  /* ---- Phase 2: DBへの自動保存 ---- */
  // 「開始」初回押下で確定するセッション識別子。以後の保存はすべてこのIDへの upsert（冪等）。
  const dbSessionRef = useRef<{ id: string; startedAt: number } | null>(null);
  const endedAtRef = useRef<number | null>(null);
  // interval / beforeunload から常に最新の entries・cards を読むための鏡（stale closure 回避）。
  // render 中の ref 書き込みは React Compiler 系 lint に反するため effect で退避する。
  const latestRef = useRef({ entries, cards, jobCards, reasonCard, speakerLabels });
  useEffect(() => {
    latestRef.current = { entries, cards, jobCards, reasonCard, speakerLabels };
  }, [entries, cards, jobCards, reasonCard, speakerLabels]);
  const saveFailedRef = useRef(false);
  // 保存が失敗している間は上部バーに出しっぱなしにする（toast 1回だけだと気づけないため）。
  // 次の保存が1回成功したら消える。
  const [saveFailed, setSaveFailed] = useState(false);

  const saveSession = useCallback(
    (opts?: { keepalive?: boolean }) => {
      const session = dbSessionRef.current;
      if (!session) return;
      const { entries: curEntries, cards: curCards, jobCards: curJobs, reasonCard: curReason, speakerLabels: curLabels } = latestRef.current;
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
        // Phase 5: questions（確認ポイント）も保存する（Json相乗り・形式拡張のみ。Phase 6 で source は廃止）。
        ...curJobs.map((j) => ({
          t: new Date(j.updatedAt).toISOString(),
          mode: "auto-job" as const,
          sourceText: j.title,
          resultText: j.text,
          questions: j.questions,
        })),
        ...(curReason
          ? [{
              t: new Date(curReason.updatedAt).toISOString(),
              mode: "auto-reason" as const,
              sourceText: "転職理由",
              resultText: curReason.text,
              questions: curReason.questions,
            }]
          : []),
      ].sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
      const payload = {
        sessionId: session.id,
        startedAt: new Date(session.startedAt).toISOString(),
        endedAt: endedAtRef.current ? new Date(endedAtRef.current).toISOString() : null,
        // Phase 7: speaker は解決済み表示名（CA/求職者/話者3…）で保存する（Json相乗り・テーブル変更なし）。
        // 保存は毎回全量上書きのため、途中で「話者入れ替え」しても次の保存でラベルが揃う。
        transcript: curEntries.map((e) => {
          const label = labelOf(e, curLabels);
          return { t: new Date(e.timestamp).toISOString(), text: e.text, ...(label ? { speaker: label } : {}) };
        }),
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
          setSaveFailed(false);
        })
        .catch(() => {
          // 失敗してもUIは止めない（sessionStorage 退避は継続・次の保存でリトライ）。連続失敗の初回だけ軽く通知し、
          // 失敗が続いている間は上部バーのインジケーターを出し続ける。
          setSaveFailed(true);
          if (!saveFailedRef.current) {
            saveFailedRef.current = true;
            toast.warning("記録の自動保存に失敗しました。次回の保存で再試行します");
          }
        });
    },
    [interviewId, labelOf]
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
    // Phase 6: 開始時の下書き生成（bootstrap）は廃止。画面は白紙のまま会話からカードが生まれる。
    // sessionStarted は事前情報の切り替えロック用（cache とキーターム前提を面談中に変えない）。
    setSessionStarted(true);
    start();
  }, [start]);

  const handleStop = useCallback(() => {
    stop();
    endedAtRef.current = Date.now();
    saveSession();
  }, [stop, saveSession]);

  /* ---- Phase 7: ログ全文コピー（時刻・話者付き。カード・解説は含めない） ---- */
  const handleCopyLog = useCallback(() => {
    const { entries: curEntries, speakerLabels: curLabels } = latestRef.current;
    if (curEntries.length === 0) return;
    const text = curEntries
      .map((e) => {
        const label = labelOf(e, curLabels);
        return `[${formatLogTime(e.timestamp)}] ${label ? `${label}: ` : ""}${e.text}`;
      })
      .join("\n");
    navigator.clipboard.writeText(text).then(
      () => toast.success("コピーしました"),
      () => toast.error("コピーに失敗しました")
    );
  }, [labelOf]);

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
    // Phase 7: 話者ラベル付きで送る（誤りうる前提は explain の指示文に明記済み）。
    const text = recent
      .map((e) => {
        const label = labelOf(e, speakerLabels);
        return label ? `${label}: ${e.text}` : e.text;
      })
      .join("\n");
    if (!text.trim()) {
      toast.info("直近30秒の発話がありません");
      return;
    }
    runExplain("recent", text);
  }, [entries, runExplain, labelOf, speakerLabels]);

  const explainSelection = useCallback(() => {
    if (!selectionText.trim()) return;
    runExplain("selection", selectionText);
  }, [selectionText, runExplain]);

  /* ---- Phase 3/4: 自動検知（発話が確定するたびに新規発話をスキャンし、用語/業務内容/転職理由カードを自動生成） ---- */
  // スキャン済み entries 件数。API成功時のみ進める（失敗時は同じ発話を次回リトライ）。
  const scannedCountRef = useRef(0);
  // 多重実行防止（API応答中に重ねて呼ばない）。
  const scanInFlightRef = useRef(false);
  // Phase 4: 直前のスキャン完了時刻。ここから AUTO_SCAN_COOLDOWN_MS 空けて次を実行する（暴走防止）。
  const lastScanEndRef = useRef(0);
  // 実行待ちのスキャン予約（クールダウン待ち）。予約は常に1本まで＝待ち中の確定発話は自動的にまとめて送られる。
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 予約発火時に前のスキャンがまだ応答待ちだった場合の「完了後に予約し直す」印。
  const scanPendingRef = useRef(false);
  // runAutoScan の完了後処理から予約関数を呼ぶための鏡（相互参照を避ける）。
  const scheduleAutoScanRef = useRef<() => void>(() => {});
  // 再解説防止のための解説済み用語リスト（直近 EXPLAINED_TERMS_MAX 件）。
  const explainedTermsRef = useRef<string[]>([]);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Phase 7: 連続失敗カウント。閾値に達したら上部バーに赤字を出す（1回成功で消える）。
  const scanFailCountRef = useRef(0);
  const [scanError, setScanError] = useState(false);
  const markScanFailure = useCallback(() => {
    scanFailCountRef.current += 1;
    if (scanFailCountRef.current >= AUTO_SCAN_FAIL_THRESHOLD) setScanError(true);
  }, []);

  const runAutoScan = useCallback(async () => {
    if (scanInFlightRef.current) return;
    const { entries: curEntries, jobCards: curJobs, reasonCard: curReason, speakerLabels: curLabels } = latestRef.current;
    const newEntries = curEntries.slice(scannedCountRef.current);
    // Phase 7: 話者ラベル付きで送る（AIの読み取りが良くなる。ラベルは誤りうる前提を指示文に明記済み）。
    const text = newEntries
      .map((e) => {
        const label = labelOf(e, curLabels);
        return label ? `${label}: ${e.text}` : e.text;
      })
      .join("\n");
    if (text.length < AUTO_SCAN_MIN_CHARS) return; // 無言・相槌のみの区間は呼ばない
    const scannedCount = curEntries.length;
    scanInFlightRef.current = true;
    try {
      const res = await fetch("/api/interview-support/auto-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Phase 7: 応答が永久に返らないと scanInFlight が立ちっぱなしで以後のスキャンが全部止まるため、
        // タイムアウトで必ず打ち切る（打ち切りは catch → 次回リトライ）。
        signal: AbortSignal.timeout(AUTO_SCAN_TIMEOUT_MS),
        body: JSON.stringify({
          text,
          // Phase 7: シート抽出テキストは送らない（漏えい修正）。固有名詞リストだけを毎回同じ配列で
          // 添える（byte一致で prompt cache に乗せる）。用途は文字起こしの表記補正のみ。
          keyterms: priorKeytermsRef.current.length > 0 ? priorKeytermsRef.current : undefined,
          explainedTerms: explainedTermsRef.current,
          existingJobs: curJobs.map((j) => ({
            key: j.key,
            title: j.title,
            text: j.text,
            questions: j.questions,
          })),
          existingReason: curReason ? { text: curReason.text, questions: curReason.questions } : null,
        }),
      });
      if (!res.ok) {
        // 連続失敗は赤字表示（Phase 7）。スキャン済み位置は進めない＝次回同じ発話でリトライ。
        markScanFailure();
        return;
      }
      const data = (await res.json()) as {
        terms?: Array<{ term?: string; text?: string }>;
        jobs?: Array<{ key?: string; title?: string; text?: string; questions?: string[] }>;
        reason?: { text?: string; questions?: string[] } | null;
      };
      scannedCountRef.current = scannedCount;
      // 成功。連続失敗カウントとエラー表示をリセット（Phase 7）。
      scanFailCountRef.current = 0;
      setScanError(false);

      let applied = false;
      const now = Date.now();
      const asQuestions = (v: string[] | undefined): string[] =>
        (Array.isArray(v) ? v : []).filter((q) => typeof q === "string" && q.trim() !== "").slice(0, 3);

      // ②業務内容: key が既存なら同カードを更新して育てる。新規 key は固定エリアに追加。
      const jobs = (data.jobs ?? []).flatMap((j) =>
        j?.key && j?.text
          ? [{ key: j.key, title: j.title ?? "", text: j.text, questions: asQuestions(j.questions) }]
          : []
      );

      // ①用語: 時系列エリアに完成カードとして積む。解説済みは再解説しない。
      // Phase 5 保険: 既存/今回の業務内容カードの title・key に含まれる語（職種名等）は用語カードにしない
      // （プロンプトでも禁止しているが、すり抜けをクライアント側で最終除外する）。
      const jobTitleTexts = [
        ...curJobs.flatMap((j) => [j.title, j.key]),
        ...jobs.flatMap((j) => [j.title, j.key]),
      ].filter(Boolean);
      const newTermCards: ExplainCard[] = [];
      for (const t of (data.terms ?? []).slice(0, 2)) {
        if (!t?.term || !t?.text) continue;
        if (explainedTermsRef.current.includes(t.term)) continue;
        if (jobTitleTexts.some((title) => title.includes(t.term!))) continue;
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

      if (jobs.length > 0) {
        applied = true;
        setJobCards((prev) => {
          const next = [...prev];
          for (const j of jobs) {
            const idx = next.findIndex((c) => c.key === j.key);
            if (idx >= 0) {
              next[idx] = {
                ...next[idx],
                title: j.title || next[idx].title,
                text: j.text,
                questions: j.questions,
                updatedAt: now,
                highlight: true,
              };
            } else {
              next.push({
                key: j.key,
                title: j.title || "業務内容",
                text: j.text,
                questions: j.questions,
                updatedAt: now,
                highlight: true,
              });
            }
          }
          return next;
        });
      }

      // ③転職理由: 全体で1枚の更新型（統合済みの最新版で置き換え）。
      if (data.reason?.text) {
        applied = true;
        setReasonCard({
          text: data.reason.text,
          questions: asQuestions(data.reason.questions),
          updatedAt: now,
          highlight: true,
        });
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
      // 通信失敗・タイムアウト（scannedCount を進めていないので次回同じ発話でリトライ）。
      // 連続すると赤字表示（Phase 7）。
      markScanFailure();
    } finally {
      scanInFlightRef.current = false;
      lastScanEndRef.current = Date.now();
      // 応答待ちの間に予約が発火していた分（＝その間の確定発話）は、完了後に改めて予約し直す。
      if (scanPendingRef.current) {
        scanPendingRef.current = false;
        scheduleAutoScanRef.current();
      }
    }
  }, [saveSession, labelOf, markScanFailure]);

  // Phase 4: 発話が確定するたびにスキャンを予約する（30秒タイマーは廃止）。
  // 直前のスキャン完了から AUTO_SCAN_COOLDOWN_MS 経つまでは待ち、その間の確定発話は次の1回にまとめて送る。
  const scheduleAutoScan = useCallback(() => {
    if (scanTimerRef.current) return; // 予約済み（後続の確定発話も同じ1回に乗る）
    const wait = Math.max(0, lastScanEndRef.current + AUTO_SCAN_COOLDOWN_MS - Date.now());
    scanTimerRef.current = setTimeout(() => {
      scanTimerRef.current = null;
      if (scanInFlightRef.current) {
        // 前のスキャンがまだ応答待ち。取りこぼさないよう完了後の予約し直しに委ねる。
        scanPendingRef.current = true;
        return;
      }
      void runAutoScan();
    }, wait);
  }, [runAutoScan]);
  useEffect(() => {
    scheduleAutoScanRef.current = scheduleAutoScan;
  }, [scheduleAutoScan]);

  useEffect(() => {
    if (!listening) return;
    if (entries.length <= scannedCountRef.current) return; // 新規確定発話なし
    scheduleAutoScan();
  }, [entries.length, listening, scheduleAutoScan]);

  // 「停止」したら実行待ちのスキャン予約は破棄する（認識中のみ動く従来動作を維持）。
  useEffect(() => {
    if (listening) return;
    scanPendingRef.current = false;
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
  }, [listening]);

  // アンマウント時に各種タイマーを破棄。
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
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
          {/* Phase 5: 事前情報（キャリアシート等）の有無。複数候補がある時だけ選択プルダウンを出す。
              Phase 6 から事前情報は裏方専用（AIの読み取り補正＋認識キーターム）。この表示は
              「裏方が効いているか」の確認用として残す。 */}
          <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {priorInfo.status === "loading"
              ? "事前情報: 確認中…"
              : priorInfo.status === "ready"
                ? `事前情報: あり（${priorInfo.fileName}）`
                : priorInfo.status === "off"
                  ? "事前情報: 使わない"
                  : "事前情報: なし"}
          </span>
          {priorInfo.status !== "loading" && priorInfo.candidates.length > 1 && (
            <select
              value={priorInfo.status === "ready" ? priorInfo.fileId : "__none__"}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__none__") {
                  setPriorInfo((prev) => (prev.status === "loading" ? prev : { status: "off", candidates: prev.candidates }));
                } else {
                  void loadPriorInfo(v);
                }
              }}
              disabled={sessionStarted}
              title={sessionStarted ? "開始後は事前情報を切り替えられません" : "使用する事前情報ファイルを選択"}
              className="shrink-0 max-w-56 truncate rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-600 disabled:opacity-50"
            >
              {priorInfo.candidates.map((c) => (
                <option key={c.id} value={c.id}>{c.fileName}</option>
              ))}
              <option value="__none__">使わない</option>
            </select>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Phase 4 fix: 接続失敗・トークン発行失敗・異常切断は赤字で出し続ける（受信回復で消える）。
              「緑なのに何も起きない」状態を作らないための必須表示。 */}
          {engineError && (
            <span className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-sm font-medium text-red-700">
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
              文字起こしエラー: {engineError}
            </span>
          )}
          {saveFailed && (
            <span className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-sm font-medium text-red-700">
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
              保存エラー（自動で再試行します）
            </span>
          )}
          {/* Phase 7: auto-scan の連続失敗を可視化（静かに止まったままにしない）。1回成功で消える。 */}
          {scanError && (
            <span className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-sm font-medium text-red-700">
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
              自動検知エラー（自動で再試行します）
            </span>
          )}
          {/* Phase 7: 話者ラベル反転（最初の話者=CAの自動割り当てが逆だった時のワンタップ修正）。
              2人以上検出された時だけ出す。 */}
          {speakerLabels.size >= 2 && (
            <button
              type="button"
              onClick={() => setSpeakersSwapped((v) => !v)}
              title="CA と求職者のラベルを入れ替える（既存ログの表示も反転します）"
              className="rounded border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 cursor-pointer"
            >
              ⇄ 話者入れ替え
            </button>
          )}
          {/* Phase 4: 使用中の文字起こしエンジン。「ブラウザ内蔵」なら DEEPGRAM_API_KEY 未設定 or 発行失敗。 */}
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
            {engine === null ? "エンジン確認中…" : engine === "deepgram" ? "Deepgram" : "ブラウザ内蔵"}
          </span>
          {/* Phase 4 fix: 「認識中（緑）」は Deepgram から最初のメッセージを受信してから。
              それまでは「接続中…」（内蔵方式は receiving=listening のため従来どおり即緑）。 */}
          <span className="flex items-center gap-1.5 text-sm">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                listening && receiving
                  ? "bg-green-500 animate-pulse"
                  : listening
                    ? "bg-amber-400 animate-pulse"
                    : "bg-gray-300"
              }`}
            />
            <span
              className={
                listening && receiving ? "text-green-700" : listening ? "text-amber-700" : "text-gray-500"
              }
            >
              {listening && receiving ? "認識中" : listening ? "接続中…" : "停止中"}
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
              disabled={!supported || engine === null}
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

      {/* ============ 中央ログ＋右カラム（Phase 4: 解説カードを主役に ログ40% : カード60%） ============ */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* 左: 文字起こしログ＋解説ボタン */}
        <div className="flex min-w-0 flex-[2] flex-col gap-3">
          <TranscriptLog
            entries={entries}
            interimText={interimText}
            listening={listening}
            onSelectionChange={setSelectionText}
            speakerLabels={speakerLabels}
            onCopy={handleCopyLog}
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
        <div className="min-w-0 flex-[3] min-h-0">
          <ExplainCards cards={cards} jobCards={jobCards} reasonCard={reasonCard} />
        </div>
      </div>
    </div>
  );
}
