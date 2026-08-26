"use client";

// T-183: 面談サポートのAI解説カード列。新しい順に上から積む。

export type ExplainCard = {
  id: string;
  mode: "recent" | "selection";
  /** 解説対象の元テキスト抜粋（先頭30字程度）。 */
  excerpt: string;
  /** ストリーミングで流し込まれる解説文。 */
  text: string;
  status: "streaming" | "done" | "error";
  createdAt: number;
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ja-JP", { hour12: false });
}

export default function ExplainCards({ cards }: { cards: ExplainCard[] }) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
      {cards.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-400">
          「直近30秒を解説」を押すと、ここに解説が表示されます
        </div>
      )}
      {cards.map((card) => (
        <div key={card.id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                card.mode === "selection"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-blue-50 text-blue-700"
              }`}
            >
              {card.mode === "selection" ? "選択部分" : "直近30秒"}
            </span>
            <span className="font-mono text-[10px] text-gray-400">{formatTime(card.createdAt)}</span>
          </div>
          <div className="mb-2 truncate text-xs text-gray-400" title={card.excerpt}>
            「{card.excerpt}」
          </div>
          {card.status === "error" ? (
            <div className="text-sm text-red-600">{card.text || "解説の取得に失敗しました"}</div>
          ) : (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
              {card.text}
              {card.status === "streaming" && (
                <span className="text-gray-400">{card.text ? "▍" : "解説中…"}</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
