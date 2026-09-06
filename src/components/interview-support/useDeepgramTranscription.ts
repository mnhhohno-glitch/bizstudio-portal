"use client";

// T-183 Phase 4: Deepgram ストリーミング文字起こしフック。
// useSpeechTranscription（Chrome内蔵）と同一インターフェースで、画面側はエンジンを差し替えるだけで動く。
// - マイク音声を MediaRecorder（webm/opus）で約250msごとの小チャンクにして WebSocket で Deepgram へ送る。
//   コンテナ付き音声のため encoding/sample_rate の指定は不要（Deepgram 側で自動判別）。
// - 認証は /api/interview-support/stt-token が返す短時間有効トークン(JWT)を
//   Sec-WebSocket-Protocol: ["bearer", <JWT>] で渡す（永続キーはブラウザに来ない）。
//   ※ access_token クエリでの接続は本番実測でハンドシェイク拒否される（Deepgram側に記録も残らない）。
//   トークンは接続時のみ必要で、再接続のたびに取り直す。
// - interim（未確定）は「現在の発話行」として都度差し替え、is_final で確定ログに積む。
// - 接続断・エラー時は短い待機を挟んで自動再接続。ユーザーの「停止」では再接続しない。
// - T-183 Phase 6: Keyterm Prompting。setKeyterms で渡した固有名詞（キャリアシート由来の病院名・
//   資格名等）を listen URL の keyterm パラメータに載せ、nova-3 の固有名詞認識を底上げする。
//   ref 保持のため接続・再接続のたびに最新のリストが使われる（接続中の変更は次の接続から反映）。
// - T-183 Phase 7: 話者識別（diarize=true）。確定発話の words[].speaker の最頻値をその発話の
//   話者番号として TranscriptEntry.speaker に保持する。番号→表示名（CA/求職者）の割り当ては画面側で行う。

import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptEntry } from "./useSpeechTranscription";

// Deepgram 接続パラメータ。nova-3 は language=ja（日本語専用指定）に対応している。
const DEEPGRAM_MODEL = "nova-3";
const DEEPGRAM_LANGUAGE = "ja";
// 無音がこの長さ(ms)続いたら発話を確定させる（speech_final）。小さいほど確定が速い。
const ENDPOINTING_MS = 300;
// MediaRecorder が音声チャンクを吐く間隔(ms)。小さいほど低遅延だがメッセージ数が増える。
const MEDIA_CHUNK_MS = 250;
// 接続断からの自動再接続までの待機(ms)。即時リトライの連打で暴走しないための最小間隔。
const RECONNECT_DELAY_MS = 1_000;
// Keyterm Prompting に載せる語数の上限（URL長対策。prior-info API 側でも同値で切り詰めるが二重防御）。
const MAX_KEYTERMS = 50;

/** Deepgram の Results メッセージ（必要フィールドのみ）。 */
type DeepgramResultMessage = {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: Array<{
      transcript?: string;
      // Phase 7: diarize=true 時のみ。単語ごとの話者番号（0始まり）。
      words?: Array<{ speaker?: number }>;
    }>;
  };
};

/** Phase 7: 発話全体の話者番号。単語ごとの speaker の最頻値を採る（発話跨ぎの誤割当てに引っ張られない）。 */
function dominantSpeaker(words: Array<{ speaker?: number }> | undefined): number | undefined {
  if (!words) return undefined;
  const counts = new Map<number, number>();
  for (const w of words) {
    if (typeof w.speaker === "number") counts.set(w.speaker, (counts.get(w.speaker) ?? 0) + 1);
  }
  let best: number | undefined;
  let bestCount = 0;
  for (const [speaker, count] of counts) {
    if (count > bestCount) {
      best = speaker;
      bestCount = count;
    }
  }
  return best;
}

function buildListenUrl(keyterms: string[]): string {
  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    language: DEEPGRAM_LANGUAGE,
    interim_results: "true",
    endpointing: String(ENDPOINTING_MS),
    punctuate: "true",
    smart_format: "true",
    // Phase 7: 話者識別。番号→CA/求職者の表示割り当てとラベル反転は画面側で行う。
    diarize: "true",
  });
  // Phase 6: Keyterm Prompting（nova-3）。keyterm=語1&keyterm=語2... の繰り返し形式。
  // https://developers.deepgram.com/docs/keyterm
  for (const term of [...new Set(keyterms)].slice(0, MAX_KEYTERMS)) {
    params.append("keyterm", term);
  }
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of ["audio/webm;codecs=opus", "audio/webm"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined; // ブラウザ既定に任せる
}

export function useDeepgramTranscription() {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [interimText, setInterimText] = useState("");
  // listening = ユーザーの意図（開始中か停止済みか）。接続断では false にならない（自動再接続する）。
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  // 接続断時にこの値を進めて下の effect を回し直し、トークン取得から接続をやり直す。
  const [restartTick, setRestartTick] = useState(0);
  // Deepgram から最初のメッセージ（Metadata / Results）を受信できているか。
  // 「認識中（緑）」は onopen ではなくこれで判定する（緑なのに何も起きない状態を作らない）。
  const [receiving, setReceiving] = useState(false);
  // 接続失敗・トークン発行失敗・異常切断の間、上部バーに出し続けるエラー文言。回復（受信再開）で消える。
  const [engineError, setEngineError] = useState<string | null>(null);
  const idSeqRef = useRef(0);
  // Phase 6: Keyterm Prompting の語彙。ref 保持で接続時に読む（変更しても再接続はしない）。
  const keytermsRef = useRef<string[]>([]);
  const setKeyterms = useCallback((terms: string[]) => {
    keytermsRef.current = terms;
  }, []);

  useEffect(() => {
    if (!listening) return;

    // effect 1回分の接続一式。cleanup（停止・再接続時）で確実に全部閉じる。
    let cancelled = false;
    let ws: WebSocket | null = null;
    let recorder: MediaRecorder | null = null;
    let stream: MediaStream | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;
      reconnectTimer = setTimeout(() => setRestartTick((t) => t + 1), RECONNECT_DELAY_MS);
    };

    (async () => {
      // 1) マイク取得（再接続のたびに取り直す。許可は初回のみ聞かれる）
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // マイク拒否・デバイス無し。再接続しても失敗し続けるため停止に倒す。
        if (!cancelled) {
          setEngineError("マイクを使用できません（許可設定・デバイスを確認してください）");
          setListening(false);
        }
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      // 2) 一時トークン取得（接続のたびに取り直す。TTLが短いため使い回さない）
      let accessToken: string | null = null;
      try {
        const res = await fetch("/api/interview-support/stt-token", { method: "POST" });
        if (res.ok) {
          const data = (await res.json()) as { available?: boolean; accessToken?: string };
          if (data.available && data.accessToken) accessToken = data.accessToken;
        }
      } catch {
        // 通信失敗は下の再接続に任せる
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (!accessToken) {
        // キーが外された等で発行できなくなった場合。少し待って再試行（次回発行できれば復帰）。
        setEngineError("一時トークンの発行に失敗しました（自動で再試行します）");
        stream.getTracks().forEach((t) => t.stop());
        scheduleReconnect();
        return;
      }

      // 3) WebSocket 接続 → 開通後に MediaRecorder 開始
      //    （webm はストリーム先頭にヘッダを持つため、接続ごとに Recorder も作り直す）
      //    認証は bearer サブプロトコル（access_token クエリは拒否される・本番実測）。
      ws = new WebSocket(buildListenUrl(keytermsRef.current), ["bearer", accessToken]);
      ws.onopen = () => {
        if (cancelled || !stream) return;
        const mimeType = pickRecorderMimeType();
        try {
          recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        } catch {
          if (!cancelled) setSupported(false);
          setListening(false);
          return;
        }
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && ws && ws.readyState === WebSocket.OPEN) ws.send(e.data);
        };
        recorder.onerror = () => {
          setEngineError("音声の取得に失敗しました（自動で再接続します）");
          scheduleReconnect();
        };
        recorder.start(MEDIA_CHUNK_MS);
      };
      ws.onmessage = (event) => {
        if (cancelled) return;
        // Metadata / Results を問わず、最初のメッセージ受信＝実際に会話できている証拠。
        // ここで初めて「認識中（緑）」にし、出ていたエラーを消す。
        setReceiving(true);
        setEngineError(null);
        let msg: DeepgramResultMessage;
        try {
          msg = JSON.parse(String(event.data)) as DeepgramResultMessage;
        } catch {
          return;
        }
        if (msg.type !== "Results") return; // Metadata / UtteranceEnd 等は無視
        const transcript = msg.channel?.alternatives?.[0]?.transcript ?? "";
        if (msg.is_final) {
          const text = transcript.trim();
          if (text) {
            idSeqRef.current += 1;
            const speaker = dominantSpeaker(msg.channel?.alternatives?.[0]?.words);
            const entry: TranscriptEntry = {
              id: `d-${Date.now()}-${idSeqRef.current}`,
              text,
              timestamp: Date.now(),
              ...(speaker !== undefined ? { speaker } : {}),
            };
            setEntries((prev) => [...prev, entry]);
          }
          setInterimText("");
        } else {
          setInterimText(transcript);
        }
      };
      // 切断・エラー時は再接続（cancelled = ユーザー停止時は scheduleReconnect が何もしない）。
      // 認証拒否等はハンドシェイク失敗として onerror → onclose の順で来る。緑を消しエラーを出し続ける。
      ws.onclose = (e) => {
        setInterimText("");
        setReceiving(false);
        setEngineError(`接続が切断されました（自動で再接続します）code=${e.code}`);
        scheduleReconnect();
      };
      ws.onerror = () => {
        setReceiving(false);
        setEngineError("Deepgram に接続できません（自動で再接続します）");
        scheduleReconnect();
      };
    })();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // 停止済みなら無視
        }
      }
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "CloseStream" }));
          } catch {
            // 送れなければそのまま閉じる
          }
        }
        try {
          ws.close();
        } catch {
          // 閉鎖済みなら無視
        }
      }
    };
  }, [listening, restartTick]);

  const start = useCallback(() => {
    // 非対応環境（MediaRecorder / getUserMedia 無し）はここで検知する。
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setSupported(false);
      return;
    }
    setEngineError(null);
    setListening(true);
  }, []);

  const stop = useCallback(() => {
    setListening(false);
    setInterimText("");
    setReceiving(false);
    setEngineError(null); // 停止は明示操作。エラー表示は持ち越さない
  }, []);

  // sessionStorage 退避分の復元用（useSpeechTranscription と同じ約束）。
  const restore = useCallback((saved: TranscriptEntry[]) => {
    setEntries((prev) => (prev.length > 0 ? prev : saved));
  }, []);

  return { entries, interimText, listening, supported, start, stop, restore, receiving, engineError, setKeyterms };
}
