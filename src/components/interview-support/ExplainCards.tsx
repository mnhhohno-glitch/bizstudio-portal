"use client";

// T-183: 面談サポートのAI解説カード列。
// Phase 3: 上段＝固定エリア（業務内容カード=職務ごと複数可 / 転職理由カード=1枚。いずれも更新型）、
// 下段＝時系列エリア（自動検知の用語カード＋手動解説カードを新しい順）。
// 更新型カードは更新の瞬間に highlight を立て、背景色の transition で気づけるようにする。

export type ExplainCard = {
  id: string;
  // recent/selection = 手動ボタン（従来どおり） / auto-term = 自動検知の用語カード（Phase 3）
  mode: "recent" | "selection" | "auto-term";
  /** 解説対象の元テキスト抜粋（先頭30字程度）。auto-term では用語そのもの。 */
  excerpt: string;
  /** 解説対象の元テキスト全文。DB保存（explanations.sourceText）用で、カード表示には excerpt を使う。 */
  source: string;
  /** ストリーミングで流し込まれる解説文（auto-term は完成文が一括で入る）。 */
  text: string;
  status: "streaming" | "done" | "error";
  createdAt: number;
};

/** 業務内容カード（会社/職務ごとに1枚の更新型）。key は AI が同一職務の判定に使う識別子。 */
export type AutoJobCard = {
  key: string;
  title: string;
  text: string;
  /** Phase 5: 新人CAがそのまま読み上げられる確認ポイント（深掘り質問）1〜3件。 */
  questions: string[];
  updatedAt: number;
  highlight: boolean;
};

/** 転職理由カード（全体で1枚の更新型）。 */
export type AutoReasonCard = {
  text: string;
  questions: string[];
  updatedAt: number;
  highlight: boolean;
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ja-JP", { hour12: false });
}

const TIMELINE_BADGE: Record<ExplainCard["mode"], { label: string; className: string }> = {
  selection: { label: "選択部分", className: "bg-amber-50 text-amber-700" },
  recent: { label: "直近30秒", className: "bg-blue-50 text-blue-700" },
  "auto-term": { label: "自動・用語", className: "bg-emerald-50 text-emerald-700" },
};

/** 更新型カード（業務内容・転職理由）。更新時は背景を一瞬色付けして気づけるようにする。 */
function PinnedCard({
  badge,
  badgeClassName,
  title,
  text,
  questions,
  updatedAt,
  highlight,
}: {
  badge: string;
  badgeClassName: string;
  title: string | null;
  text: string;
  questions: string[];
  updatedAt: number;
  highlight: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-gray-200 p-3 shadow-sm transition-colors duration-1000 ${
        highlight ? "bg-yellow-50" : "bg-white"
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeClassName}`}>{badge}</span>
        <span className="font-mono text-[10px] text-gray-400">{formatTime(updatedAt)}</span>
      </div>
      {title && <div className="mb-1 text-sm font-semibold text-gray-700">{title}</div>}
      {/* Phase 4: 面談中に一目で読めるよう本文は一段大きく・行間広め */}
      <div className="whitespace-pre-wrap text-base leading-8 text-gray-800">{text}</div>
      {/* Phase 5: 確認ポイント（そのまま読み上げられる質問文）。本文より一段小さく。 */}
      {questions.length > 0 && (
        <div className="mt-2 border-t border-gray-100 pt-1.5">
          <div className="mb-0.5 text-[10px] font-medium text-gray-400">確認ポイント</div>
          <ul className="flex flex-col gap-0.5">
            {questions.map((q, i) => (
              <li key={i} className="text-sm leading-6 text-gray-600">・{q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ExplainCards({
  cards,
  jobCards,
  reasonCard,
}: {
  cards: ExplainCard[];
  jobCards: AutoJobCard[];
  reasonCard: AutoReasonCard | null;
}) {
  const hasPinned = jobCards.length > 0 || reasonCard !== null;
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
      {/* ============ 上段: 固定エリア（業務内容・転職理由。更新型） ============ */}
      {hasPinned && (
        <div className="flex flex-col gap-2">
          {jobCards.map((job) => (
            <PinnedCard
              key={job.key}
              badge="業務内容"
              badgeClassName="bg-indigo-50 text-indigo-700"
              title={job.title}
              text={job.text}
              questions={job.questions}
              updatedAt={job.updatedAt}
              highlight={job.highlight}
            />
          ))}
          {reasonCard && (
            <PinnedCard
              badge="転職理由"
              badgeClassName="bg-rose-50 text-rose-700"
              title={null}
              text={reasonCard.text}
              questions={reasonCard.questions}
              updatedAt={reasonCard.updatedAt}
              highlight={reasonCard.highlight}
            />
          )}
          <div className="border-b border-gray-200" />
        </div>
      )}

      {/* ============ 下段: 時系列エリア（用語＋手動解説。新しい順） ============ */}
      {!hasPinned && cards.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-400">
          会話を検知すると、ここに解説カードが自動で表示されます。
          <br />
          今すぐ知りたい時は「直近30秒を解説」を押してください
        </div>
      )}
      {cards.map((card) => {
        const badge = TIMELINE_BADGE[card.mode];
        return (
          <div key={card.id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
                {badge.label}
              </span>
              <span className="font-mono text-[10px] text-gray-400">{formatTime(card.createdAt)}</span>
            </div>
            <div className="mb-2 truncate text-xs text-gray-400" title={card.excerpt}>
              「{card.excerpt}」
            </div>
            {card.status === "error" ? (
              <div className="text-sm text-red-600">{card.text || "解説の取得に失敗しました"}</div>
            ) : (
              <div className="whitespace-pre-wrap text-base leading-8 text-gray-800">
                {card.text}
                {card.status === "streaming" && (
                  <span className="text-gray-400">{card.text ? "▍" : "解説中…"}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
