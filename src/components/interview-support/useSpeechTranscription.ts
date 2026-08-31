"use client";

// T-183: 面談サポートの文字起こしフック。
// Web Speech API（Chrome内蔵）を薄くラップし、確定発話の時系列ログを返す。
// 将来の有料文字起こしAPI差し替え時は、このフックだけを差し替えれば UI 側は無変更で済む境界とする。

import { useCallback, useEffect, useRef, useState } from "react";

/** 確定した1発話。timestamp は「直近30秒」切り出しに使う（epoch ms）。 */
export type TranscriptEntry = {
  id: string;
  text: string;
  timestamp: number;
};

// Web Speech API は TypeScript 標準の lib.dom に型が無いため、必要最小限だけ自前定義する。
type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
};
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// onend からの自動再起動の待機(ms)。即時 start の連打で再起動ループが暴走するのを防ぐ。
const RESTART_DELAY_MS = 300;

export function useSpeechTranscription() {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [interimText, setInterimText] = useState("");
  // listening = ユーザーの意図（開始中か停止済みか）。無音での勝手な onend では false にならない。
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  // Web Speech API が勝手に止まった際、この値を進めて下の effect を再実行し認識を作り直す。
  const [restartTick, setRestartTick] = useState(0);
  const idSeqRef = useRef(0);

  // listening の間、認識インスタンスを生成・稼働させる。onend（無音停止の癖）では
  // RESTART_DELAY_MS 待って restartTick を進め、この effect を回し直すことで自動再起動する。
  useEffect(() => {
    if (!listening) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return; // start() 側で検知済み。ここには来ない想定。

    const rec = new Ctor();
    rec.lang = "ja-JP";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          const text = transcript.trim();
          if (text) {
            idSeqRef.current += 1;
            const entry: TranscriptEntry = {
              id: `t-${Date.now()}-${idSeqRef.current}`,
              text,
              timestamp: Date.now(),
            };
            setEntries((prev) => [...prev, entry]);
          }
        } else {
          interim += transcript;
        }
      }
      setInterimText(interim);
    };

    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    rec.onend = () => {
      setInterimText("");
      restartTimer = setTimeout(() => setRestartTick((t) => t + 1), RESTART_DELAY_MS);
    };
    rec.onerror = (event) => {
      // not-allowed（マイク拒否）は再起動しても無限に失敗するため停止に倒す。
      // それ以外（no-speech / network 等）は続けて onend が呼ばれるので再起動はそちらに任せる。
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setListening(false);
      }
    };

    try {
      rec.start();
    } catch {
      // 二重 start 等。onend 経由の再起動に任せる。
    }

    return () => {
      // 「停止」またはアンマウント時: ハンドラを外してから止める（onend の再起動を防ぐ）。
      if (restartTimer) clearTimeout(restartTimer);
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      try {
        rec.stop();
      } catch {
        // 停止済みなら無視
      }
    };
  }, [listening, restartTick]);

  const start = useCallback(() => {
    // 非対応ブラウザ（Chrome以外）の検知はここ（イベントハンドラ）で行う。
    if (getSpeechRecognitionCtor() === null) {
      setSupported(false);
      return;
    }
    setListening(true);
  }, []);

  const stop = useCallback(() => {
    setListening(false);
    setInterimText("");
  }, []);

  // sessionStorage 退避分の復元用（マウント後に1回だけ呼ぶ。ハイドレーション不一致を避けるため初期値では受けない）。
  const restore = useCallback((saved: TranscriptEntry[]) => {
    setEntries((prev) => (prev.length > 0 ? prev : saved));
  }, []);

  // receiving / engineError は Deepgram フックとインターフェースを揃えるためのフィールド。
  // 内蔵方式は従来どおり listening=認識中（緑）表示・エラーは supported バナーで扱う。
  return { entries, interimText, listening, supported, start, stop, restore, receiving: listening, engineError: null as string | null };
}
