"use client";

// T-183 Phase 4: Deepgram ストリーミング文字起こしフック。
// useSpeechTranscription（Chrome内蔵）と同一インターフェースで、画面側はエンジンを差し替えるだけで動く。
// - マイク音声を MediaRecorder（webm/opus）で約250msごとの小チャンクにして WebSocket で Deepgram へ送る。
//   コンテナ付き音声のため encoding/sample_rate の指定は不要（Deepgram 側で自動判別）。
// - 認証は /api/interview-support/stt-token が返す短時間有効トークンを access_token クエリで渡す
//   （永続キーはブラウザに来ない）。トークンは接続時のみ必要で、再接続のたびに取り直す。
// - interim（未確定）は「現在の発話行」として都度差し替え、is_final で確定ログに積む。
// - 接続断・エラー時は短い待機を挟んで自動再接続。ユーザーの「停止」では再接続しない。

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

/** Deepgram の Results メッセージ（必要フィールドのみ）。 */
type DeepgramResultMessage = {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string }> };
};

function buildListenUrl(accessToken: string): string {
  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    language: DEEPGRAM_LANGUAGE,
    interim_results: "true",
    endpointing: String(ENDPOINTING_MS),
    punctuate: "true",
    smart_format: "true",
    access_token: accessToken,
  });
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
  const idSeqRef = useRef(0);

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
        if (!cancelled) setListening(false);
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
        stream.getTracks().forEach((t) => t.stop());
        scheduleReconnect();
        return;
      }

      // 3) WebSocket 接続 → 開通後に MediaRecorder 開始
      //    （webm はストリーム先頭にヘッダを持つため、接続ごとに Recorder も作り直す）
      ws = new WebSocket(buildListenUrl(accessToken));
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
        recorder.onerror = () => scheduleReconnect();
        recorder.start(MEDIA_CHUNK_MS);
      };
      ws.onmessage = (event) => {
        if (cancelled) return;
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
            const entry: TranscriptEntry = {
              id: `d-${Date.now()}-${idSeqRef.current}`,
              text,
              timestamp: Date.now(),
            };
            setEntries((prev) => [...prev, entry]);
          }
          setInterimText("");
        } else {
          setInterimText(transcript);
        }
      };
      // 切断・エラー時は再接続（cancelled = ユーザー停止時は scheduleReconnect が何もしない）。
      ws.onclose = () => {
        setInterimText("");
        scheduleReconnect();
      };
      ws.onerror = () => scheduleReconnect();
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
    setListening(true);
  }, []);

  const stop = useCallback(() => {
    setListening(false);
    setInterimText("");
  }, []);

  // sessionStorage 退避分の復元用（useSpeechTranscription と同じ約束）。
  const restore = useCallback((saved: TranscriptEntry[]) => {
    setEntries((prev) => (prev.length > 0 ? prev : saved));
  }, []);

  return { entries, interimText, listening, supported, start, stop, restore };
}
