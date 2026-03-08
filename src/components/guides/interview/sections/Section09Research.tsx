import SectionWrapper from "../SectionWrapper";
import InsightBlock from "../InsightBlock";

const researchItems = [
  { icon: "🏢", label: "事業内容", highlight: false },
  { icon: "💎", label: "企業理念", highlight: false },
  { icon: "📰", label: "最新ニュース", highlight: false },
  { icon: "⚔️", label: "競合他社", highlight: false },
  { icon: "⭐", label: "求める人物像", highlight: true },
];

const reverseQuestions = [
  "入社後、最初の3ヶ月でどのような成果を期待されますか？",
  "活躍している社員の方に共通する特徴はありますか？",
  "スキルアップ・成長のための支援制度はありますか？",
  "チームの雰囲気・文化を教えていただけますか？",
];

export default function Section09Research() {
  return (
    <SectionWrapper id="section-9" number="09" title="企業研究と逆質問" bg="white">
      <p className="text-base leading-relaxed text-gray-700 mb-6">
        企業研究は「貢献イメージ」を持つために行います。
        最新動向・事業内容・理念を把握し、「自分ならどう貢献できるか」をイメージすることが目的です。
      </p>

      <h3 className="text-lg font-bold text-[#003366] mb-4">調べるべき5項目</h3>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        {researchItems.map((item) => (
          <div
            key={item.label}
            className={`bg-white rounded-xl p-4 text-center shadow-sm ${
              item.highlight
                ? "border-2 border-[#F39200]"
                : "border border-gray-200"
            }`}
          >
            <p className="text-2xl mb-2">{item.icon}</p>
            <p className="text-sm font-bold text-[#003366]">{item.label}</p>
          </div>
        ))}
      </div>

      <h3 className="text-lg font-bold text-[#003366] mb-3">逆質問はアピールの場</h3>
      <p className="text-base leading-relaxed text-gray-700 mb-6">
        逆質問は「質問がない＝興味がない」と受け取られるリスクがあります。
        入社後の活躍を前提とした、前向きな質問を必ず用意しましょう。
      </p>

      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <p className="font-bold text-[#003366] mb-4">逆質問の例</p>
        <ul className="space-y-3">
          {reverseQuestions.map((q, i) => (
            <li key={i} className="text-sm leading-relaxed">
              <span className="text-[#0090D1] font-bold">Q.</span> {q}
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-red-50 border-l-4 border-red-400 rounded-r-lg p-4 mb-6">
        <p className="text-red-600 font-bold text-sm mb-1">避けるべき逆質問</p>
        <p className="text-sm text-gray-700">
          給与・休日・残業など待遇面のみの質問（特に一次面接では）。入社意欲より条件重視に映ります。
        </p>
      </div>

      <InsightBlock>
        逆質問は「アピールの場」。入社後の活躍を前提とした質問が、面接官に「この人は本気だ」という印象を与える。
      </InsightBlock>
    </SectionWrapper>
  );
}
