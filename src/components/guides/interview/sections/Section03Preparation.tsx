import SectionWrapper from "../SectionWrapper";
import InsightBlock from "../InsightBlock";
import StepCard from "../StepCard";

const steps = [
  {
    step: 1,
    title: "基礎工事 — 転職軸の言語化",
    subtitle: "すべての土台",
    description:
      "「なぜ転職するのか」「何を大切にして働きたいか」「どんな自分になりたいか」を徹底的に言語化する。",
  },
  {
    step: 2,
    title: "骨組み — 一貫性のあるストーリー構築",
    subtitle: "軸をつなぐ",
    description:
      "過去・現在・未来を「軸」という一本の線でつなぎ、どの質問にも同じ核から答えられる論理を組み立てる。",
  },
  {
    step: 3,
    title: "内装・仕上げ — 具体的な回答・話し方・マナー",
    subtitle: "最後の磨き",
    description:
      "PREP法・具体的エピソード・清潔感・明るい挨拶。基礎と骨組みが固まって初めて効果を発揮します。",
  },
];

export default function Section03Preparation() {
  return (
    <SectionWrapper id="section-3" number="03" title="面接準備の正しい順番" bg="white">
      <div className="text-base leading-relaxed text-gray-700 mb-6">
        <p>
          多くの人が「想定Q&Aの丸暗記」から面接対策を始めてしまいます。
          しかし、これは家づくりで言えば「内装から始める」ようなもの。
          基礎のない家は、深掘り（揺れ）で崩壊します。
        </p>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="https://d2xsxph8kpxj0f.cloudfront.net/310519663313492644/ZTiYRP5Jw2YkRZKv6gXb5E/house_diagram-HZhiaU2but4ZtWWKef8VfR.webp"
        alt="面接準備の家づくり図"
        className="w-full max-w-lg mx-auto my-8 rounded-xl"
      />

      <h3 className="text-lg font-bold text-[#003366] mb-4">正しい準備の順番</h3>

      <div className="space-y-4">
        {steps.map((s) => (
          <StepCard key={s.step} {...s} />
        ))}
      </div>

      <InsightBlock>
        GOAL：基礎がしっかりしていれば、どんな深掘りにも動じない。
        <br />
        「なぜ？」を5回繰り返されても崩れないロジックが完成する。
      </InsightBlock>
    </SectionWrapper>
  );
}
