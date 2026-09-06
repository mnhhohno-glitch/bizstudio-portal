"use client";

// T-183: 面談サポートの文字起こしログ表示。
// 1確定発話=1行（行頭に HH:MM:SS）。自動で最下部へ追従し、ユーザーが上へスクロールしたら追従を止める。
// Phase 7: 話者ラベル（CA/求職者）を時刻の後に表示（speakerLabels は画面側で番号→表示名に解決済み）。
// 枠の右上に小さな「コピー」ボタン（時刻・話者付き全文をクリップボードへ。カード・解説は含めない）。

import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptEntry } from "./useSpeechTranscription";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ja-JP", { hour12: false });
}

// 最下部からこの距離(px)以内なら「最下部にいる」とみなす。
const BOTTOM_THRESHOLD_PX = 48;

// Phase 7: 話者ラベルの色分け（CA/求職者を薄く区別。それ以外の話者はグレー）。
function speakerLabelClass(label: string): string {
  if (label === "CA") return "text-blue-600";
  if (label === "求職者") return "text-emerald-600";
  return "text-gray-500";
}

export default function TranscriptLog({
  entries,
  interimText,
  listening,
  onSelectionChange,
  speakerLabels,
  onCopy,
}: {
  entries: TranscriptEntry[];
  interimText: string;
  listening: boolean;
  /** ログ内のテキスト選択が変わるたびに選択文字列（無選択は空文字）を通知する。 */
  onSelectionChange: (text: string) => void;
  /** Phase 7: 話者番号→表示名（CA/求職者/話者3…）。diarization 無し（内蔵方式等）は空 Map。 */
  speakerLabels: Map<number, string>;
  /** Phase 7: 右上「コピー」ボタン。undefined ならボタンを出さない。 */
  onCopy?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  // scrollTo 由来の onScroll でユーザー操作と誤判定しないためのフラグ。
  const programmaticScrollRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
  }, []);

  // 新しい発話・中間結果が来たら追従スクロール。
  useEffect(() => {
    if (autoFollow) scrollToBottom();
  }, [entries, interimText, autoFollow, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false;
      return;
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX;
    setAutoFollow(atBottom);
  }, []);

  // ログ内のテキスト選択を監視して親へ通知（「選択部分を解説」ボタンの出現条件）。
  useEffect(() => {
    const handler = () => {
      const sel = window.getSelection();
      const el = containerRef.current;
      if (!sel || !el || sel.isCollapsed) {
        onSelectionChange("");
        return;
      }
      const anchor = sel.anchorNode;
      const focus = sel.focusNode;
      const inside = !!anchor && !!focus && el.contains(anchor) && el.contains(focus);
      onSelectionChange(inside ? sel.toString().trim() : "");
    };
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [onSelectionChange]);

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto rounded-lg border border-gray-200 bg-white px-4 py-3"
      >
        {entries.length === 0 && !interimText && (
          <div className="py-10 text-center text-sm text-gray-400">
            {listening
              ? "音声を待っています。話し始めるとここに文字が流れます。"
              : "「開始」を押すと文字起こしが始まります。"}
          </div>
        )}
        {entries.map((entry) => {
          const label = entry.speaker !== undefined ? speakerLabels.get(entry.speaker) : undefined;
          return (
            <div key={entry.id} className="flex gap-3 py-1 text-sm leading-relaxed">
              <span className="shrink-0 select-none font-mono text-xs text-gray-400 pt-0.5">
                {formatTime(entry.timestamp)}
              </span>
              <span className="text-gray-800 whitespace-pre-wrap">
                {label && (
                  <span className={`font-medium ${speakerLabelClass(label)}`}>{label}: </span>
                )}
                {entry.text}
              </span>
            </div>
          );
        })}
        {interimText && (
          <div className="flex gap-3 py-1 text-sm leading-relaxed">
            <span className="shrink-0 select-none font-mono text-xs text-gray-300 pt-0.5">
              --:--:--
            </span>
            <span className="text-gray-400 whitespace-pre-wrap">{interimText}</span>
          </div>
        )}
      </div>
      {/* Phase 7: ログ全文コピー（時刻・話者付き）。右上に小さく置き、スクロールしても位置固定。 */}
      {onCopy && entries.length > 0 && (
        <button
          type="button"
          onClick={onCopy}
          title="文字起こしログ全文をコピー（時刻・話者付き）"
          className="absolute top-2 right-4 rounded border border-gray-200 bg-white/90 px-2.5 py-1 text-xs text-gray-600 shadow-sm hover:bg-gray-50 cursor-pointer"
        >
          コピー
        </button>
      )}
      {!autoFollow && (
        <button
          type="button"
          onClick={() => {
            setAutoFollow(true);
            scrollToBottom();
          }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-gray-800/90 px-4 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-gray-700 cursor-pointer"
        >
          ↓ 最新へ
        </button>
      )}
    </div>
  );
}
