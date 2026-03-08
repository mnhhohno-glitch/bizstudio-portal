import SectionWrapper from "../SectionWrapper";
import InsightBlock from "../InsightBlock";
import NgOkComparison from "../NgOkComparison";

const strengthCards = [
  {
    icon: "🎯",
    title: "スキル面 — 証明できる強み",
    items: [
      "資格・実績・数値で示せる成果",
      "前職で習得した専門スキル",
      "他者から評価・感謝された経験",
    ],
  },
  {
    icon: "💡",
    title: "人物面 — 人となりの強み",
    items: [
      "価値観・思考パターン・行動習慣",
      "チームでの役割・コミュニケーション",
      "困難を乗り越えた姿勢・粘り強さ",
    ],
  },
];

export default function Section07Strengths() {
  return (
    <SectionWrapper id="section-7" number="07" title="強みの整理と具体的な伝え方" bg="white">
      <p className="text-base leading-relaxed text-gray-700 mb-6">
        あなたの「オリジナリティ」を整理するとき、2つの視点で考えると伝わりやすくなります。
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {strengthCards.map((card) => (
          <div
            key={card.title}
            className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm"
          >
            <p className="text-2xl mb-2">{card.icon}</p>
            <p className="font-bold text-[#003366] mb-3">{card.title}</p>
            <ul className="space-y-2">
              {card.items.map((item, i) => (
                <li key={i} className="text-sm text-gray-600 flex gap-2">
                  <span className="shrink-0">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <h3 className="text-lg font-bold text-[#003366] mb-3">具体的に語る：NG vs OK</h3>
      <NgOkComparison
        ng="「御社の理念に共感しました」→ 抽象的すぎて印象に残らない"
        ok="「理念の〇〇という部分が、自身の△△という経験に基づく軸と合致したため共感しました」"
      />
      <NgOkComparison
        ng="「コミュニケーション能力に自信があります」→ 誰でも言える、証明できない"
        ok="「前職で〇〇の課題を抱えるお客様に対し、△△のアプローチで□□という成果を出しました」"
      />

      <InsightBlock>
        あなたの「オリジナリティ」はどこにある？スキル×人物の両面で整理することで、他の候補者との差別化が生まれる。
      </InsightBlock>
    </SectionWrapper>
  );
}
