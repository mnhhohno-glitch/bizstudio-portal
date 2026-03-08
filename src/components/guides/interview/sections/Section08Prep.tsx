import SectionWrapper from "../SectionWrapper";

interface Section08Props {
  data: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

const prepSteps = [
  { letter: "P", label: "Point（結論）", hint: "「私の強みは〇〇です」" },
  { letter: "R", label: "Reason（理由）", hint: "「なぜなら〜だからです」" },
  { letter: "E", label: "Example（具体例）", hint: "「例えば前職で〜」" },
  { letter: "P", label: "Point（再結論）", hint: "「だから御社で〇〇できます」" },
];

const prepFields = [
  {
    key: "prep_point",
    letter: "P",
    label: "Point（結論）",
    placeholder: "「私の強みは〇〇です」",
    badgeColor: "bg-[#003366]",
    rows: 3,
  },
  {
    key: "prep_reason",
    letter: "R",
    label: "Reason（理由）",
    placeholder: "「なぜなら〜だからです」",
    badgeColor: "bg-[#0090D1]",
    rows: 3,
  },
  {
    key: "prep_example",
    letter: "E",
    label: "Example（具体例）",
    placeholder: "「例えば前職で〜」",
    badgeColor: "bg-[#F39200]",
    rows: 4,
  },
  {
    key: "prep_conclusion",
    letter: "P",
    label: "Point（再結論）",
    placeholder: "「だから御社で〇〇できます」",
    badgeColor: "bg-[#003366]",
    rows: 3,
  },
];

const rules = [
  {
    number: 1,
    title: "時間管理 — 1回答 = 1分以内",
    items: [
      "結論から話し始める（PREP法の徹底）",
      "エピソードは1つに絞り込む",
      "「〜だと思います」より「〜です」と言い切る",
    ],
  },
  {
    number: 2,
    title: "印象管理 — 清潔感と明るさが最後に効く",
    items: [
      "清潔感のある服装・身だしなみ",
      "明るい挨拶・元気な返事（これが一番効く）",
      "面接官の目を見て、笑顔で対話する",
    ],
  },
  {
    number: 3,
    title: "深掘り対策 — 「なぜ？」に動じない準備",
    items: [
      "軸が固まっていれば深掘りは怖くない",
      "「それはなぜですか？」を5回想定する",
      "答えに詰まったら「少し考えさせてください」でOK",
    ],
  },
];

export default function Section08Prep({ data, onChange }: Section08Props) {
  return (
    <SectionWrapper id="section-8" number="08" title="評価を上げる話し方の技術" bg="soft">
      <p className="text-base leading-relaxed text-gray-700 mb-6">
        面接での回答は、PREP法を使って構造化することで「論理的な人」という印象を作れます。
      </p>

      <div className="flex flex-col md:flex-row items-stretch gap-4 my-8">
        {prepSteps.map((step, i) => (
          <div
            key={i}
            className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 text-center flex-1"
          >
            <p className="text-3xl font-black text-[#003366]">{step.letter}</p>
            <p className="text-sm font-bold text-[#003366] mt-1">{step.label}</p>
            <p className="text-xs text-gray-500 mt-2">{step.hint}</p>
          </div>
        ))}
      </div>

      <div className="border-2 border-[#003366] rounded-xl p-6 md:p-8 my-8 bg-white">
        <h3 className="text-lg font-bold text-[#003366] mb-1">🎤 PREP法 練習シート</h3>
        <p className="text-sm text-gray-600 mb-6">
          自己PRをPREP法で組み立ててみよう
        </p>

        <div className="space-y-6">
          {prepFields.map((field) => (
            <div key={field.key}>
              <label className="block mb-2">
                <span
                  className={`${field.badgeColor} text-white text-xs font-bold px-2 py-1 rounded`}
                >
                  {field.letter}
                </span>
                <span className="text-sm font-medium text-[#003366] ml-2">{field.label}</span>
              </label>
              <textarea
                value={data[field.key] || ""}
                onChange={(e) => onChange(field.key, e.target.value)}
                rows={field.rows}
                placeholder={field.placeholder}
                className="w-full border border-gray-300 rounded-lg p-4 text-base focus:border-[#003366] focus:ring-2 focus:ring-[#003366]/20 focus:outline-none transition-colors duration-200 placeholder:text-gray-400"
              />
            </div>
          ))}
        </div>
      </div>

      <h3 className="text-lg font-bold text-[#003366] mb-4">3つのルール</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {rules.map((rule) => (
          <div
            key={rule.number}
            className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm"
          >
            <p className="text-[#F39200] font-black text-sm">RULE {rule.number}</p>
            <p className="font-bold text-[#003366] mt-1">{rule.title}</p>
            <ul className="text-sm text-gray-600 mt-3 space-y-2">
              {rule.items.map((item, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </SectionWrapper>
  );
}
