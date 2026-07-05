"use client";

// T-091: 選択した企業の直近の面接日程を、企業名・日時・面接方法込みで一覧コピー。
// 罠 #17: 日付・曜日・時刻はクライアント JST 基準。toISOString は禁止。
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useOverlayClose } from "@/hooks/useOverlayClose";
import type { Entry } from "./EntryBoard";

type Props = {
  selectedEntries: Entry[];
  onClose: () => void;
};

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

// JST 基準の YYYY-MM-DD 文字列を返す。
function jstYmd(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

// JST 基準の Date を返す（曜日・月日抽出用）。
function toJstDate(dateIso: string, time: string): Date {
  const ymd = jstYmd(new Date(dateIso));
  const [hh, mm] = time.split(":");
  // JST の壁時計を表す Date を作るため、JST の YYYY-MM-DD と HH:mm を結合して JST タイムゾーン付きで解釈する。
  // new Date("YYYY-MM-DDTHH:mm:00+09:00") は壁時計と JST オフセットを与えた瞬間 UTC として正しい時刻を表現する。
  return new Date(`${ymd}T${hh.padStart(2, "0")}:${mm.padStart(2, "0")}:00+09:00`);
}

type Pick = {
  entry: Entry;
  ts: number;
  date: Date;
  tool: string | null;
};

function pickNearestFutureInterview(entry: Entry, nowMs: number): Pick | null {
  const slots: { dateIso: string | null; time: string | null; tool: string | null }[] = [
    { dateIso: entry.firstInterviewDate, time: entry.firstInterviewTime, tool: entry.firstInterviewTool },
    { dateIso: entry.secondInterviewDate, time: entry.secondInterviewTime, tool: entry.secondInterviewTool },
    { dateIso: entry.finalInterviewDate, time: entry.finalInterviewTime, tool: entry.finalInterviewTool },
  ];
  let best: Pick | null = null;
  for (const s of slots) {
    if (!s.dateIso || !s.time) continue;
    const d = toJstDate(s.dateIso, s.time);
    const ts = d.getTime();
    if (!Number.isFinite(ts) || ts < nowMs) continue;
    if (!best || ts < best.ts) {
      best = { entry, ts, date: d, tool: s.tool };
    }
  }
  return best;
}

function formatLine(p: Pick): string {
  // JST 基準で月日・曜日・時刻を取り出す（罠 #17 を回避）。
  const ymd = jstYmd(p.date); // "YYYY-MM-DD"
  const [, mStr, dStr] = ymd.split("-");
  const m = parseInt(mStr, 10);
  const day = parseInt(dStr, 10);
  // 曜日は Intl.DateTimeFormat の Asia/Tokyo・narrow で JST 基準を保証。
  const weekday = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", weekday: "narrow" }).format(p.date);
  void WEEKDAY_JA;
  const hhmm = p.date.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
  const head = `${p.entry.companyName}｜${m}/${day}(${weekday}) ${hhmm}~`;
  return p.tool ? `${head}｜${p.tool}` : head;
}

export default function InterviewGuideCopyModal({ selectedEntries, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const { text, excludedCount } = useMemo(() => {
    const now = Date.now();
    const picks: Pick[] = [];
    let excluded = 0;
    for (const entry of selectedEntries) {
      const p = pickNearestFutureInterview(entry, now);
      if (p) picks.push(p);
      else excluded++;
    }
    picks.sort((a, b) => a.ts - b.ts);
    return { text: picks.map(formatLine).join("\n"), excludedCount: excluded };
  }, [selectedEntries]);

  const [editable, setEditable] = useState(text);
  const overlayClose = useOverlayClose(onClose);

  // 選択企業が変わった場合に再初期化
  useEffect(() => { setEditable(text); }, [text]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editable);
      setCopied(true);
      toast.success("コピーしました");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("コピーに失敗しました");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" {...overlayClose}>
      <div className="bg-white rounded-lg p-5 max-w-xl w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-gray-700 mb-3">面接案内コピー</h3>
        <p className="text-[12px] text-gray-500 mb-2">
          選択した企業のうち、今日以降の直近面接日程を 1 件ずつ・日付昇順で出力します。
        </p>
        <textarea
          value={editable}
          onChange={(e) => setEditable(e.target.value)}
          rows={10}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 mb-2"
          placeholder="（対象なし）"
        />
        {excludedCount > 0 && (
          <p className="text-[11px] text-gray-500 mb-3">対象外: {excludedCount}社（未来の面接日程なし）</p>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm hover:bg-gray-50"
          >閉じる</button>
          <button
            onClick={handleCopy}
            disabled={!editable.trim()}
            className="bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >{copied ? "コピー済 ✓" : "コピー"}</button>
        </div>
      </div>
    </div>
  );
}
