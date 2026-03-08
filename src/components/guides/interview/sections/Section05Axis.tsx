import SectionWrapper from "../SectionWrapper";
import InsightBlock from "../InsightBlock";

interface Section05Props {
  data: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

const worksheetFields = [
  {
    number: 1,
    key: "reason_for_change",
    label: "なぜ転職するのか？",
    placeholder: "ネガティブな理由ではなく「向かう先」として書いてみましょう",
  },
  {
    number: 2,
    key: "work_values",
    label: "何を大切にして働きたいか？",
    placeholder: "あなたが仕事で「これは譲れない」と思う価値観を書いてみましょう",
  },
  {
    number: 3,
    key: "future_vision",
    label: "どんな自分になりたいか？",
    placeholder: "5年後・10年後のキャリアビジョンを具体的にイメージしてみましょう",
  },
];

export default function Section05Axis({ data, onChange }: Section05Props) {
  return (
    <SectionWrapper id="section-5" number="05" title="転職軸とは何か" bg="white">
      <div className="text-base leading-relaxed text-gray-700 mb-6">
        <p>
          転職軸とは、あなたが仕事において大切にしている価値観・信念・なりたい自分像のことです。
          これが言語化されていないと、面接でどんな質問をされても「ブレた回答」になってしまいます。
        </p>
      </div>

      <InsightBlock>
        転職軸は「逃げ」ではなく「向かう先」として語ることが重要。
        <br />
        ネガティブな理由をポジティブな動機に言い換える。
      </InsightBlock>

      <div className="border-2 border-[#003366] rounded-xl p-6 md:p-8 mt-8">
        <h3 className="text-lg font-bold text-[#003366] mb-1">✏️ 転職軸ワークシート</h3>
        <p className="text-sm text-gray-600 mb-6">
          3つの問いに答えて、あなたの「軸」を言語化しよう
        </p>

        <div className="space-y-6">
          {worksheetFields.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-[#003366] mb-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#003366] text-white text-xs font-bold mr-2">
                  {field.number}
                </span>
                {field.label}
              </label>
              <textarea
                value={data[field.key] || ""}
                onChange={(e) => onChange(field.key, e.target.value)}
                rows={4}
                placeholder={field.placeholder}
                className="w-full border border-gray-300 rounded-lg p-4 text-base focus:border-[#003366] focus:ring-2 focus:ring-[#003366]/20 focus:outline-none transition-colors duration-200 placeholder:text-gray-400"
              />
            </div>
          ))}
        </div>
      </div>
    </SectionWrapper>
  );
}
