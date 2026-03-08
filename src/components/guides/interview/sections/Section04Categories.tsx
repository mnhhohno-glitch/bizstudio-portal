import SectionWrapper from "../SectionWrapper";
import InsightBlock from "../InsightBlock";
import TimelineCard from "../TimelineCard";

const timelines = [
  {
    label: "過去",
    sublabel: "最大ボリューム",
    color: "#0090D1",
    questions: ["職務経歴・実績は？", "転職・退職理由は？"],
    axisNote: "事実＋「学び」を転職軸に紐づけて語る",
  },
  {
    label: "現在",
    sublabel: "核心・最重要",
    color: "#F39200",
    questions: ["自己PRをしてください", "志望動機を教えてください"],
    axisNote: "「転職軸」から導かれる価値観・強みを語る",
  },
  {
    label: "未来",
    sublabel: "最終面接",
    color: "#003366",
    questions: ["入社後のキャリアビジョンは？", "どんな貢献ができますか？"],
    axisNote: "「転職軸」から導かれる将来像を企業と重ねる",
  },
];

export default function Section04Categories() {
  return (
    <SectionWrapper id="section-4" number="04" title="面接質問の3大分類" bg="soft">
      <p className="text-base leading-relaxed text-gray-700 mb-6">
        面接で聞かれる質問は、どんなに種類が多くても
        「過去・現在・未来」の3軸に整理できます。
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {timelines.map((t) => (
          <TimelineCard key={t.label} {...t} />
        ))}
      </div>

      <InsightBlock>
        一次面接は「過去」の経験・思考が中心。
        <br />
        最終面接は「未来」のビジョンと貢献イメージが問われる。
      </InsightBlock>
    </SectionWrapper>
  );
}
