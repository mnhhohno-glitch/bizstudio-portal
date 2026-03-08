"use client";

import SectionWrapper from "../SectionWrapper";

interface Section10Props {
  data: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

const actions = [
  {
    number: "01",
    title: "「基礎工事（軸の言語化）」から着手する",
    description:
      "なぜ転職？何を大切にしている？どこへ向かう？を紙に書き出す。これがすべての土台になります。",
  },
  {
    number: "02",
    title: "過去・現在・未来を「軸」という線でつなぐ",
    description:
      "エピソードを一本の軸で整理し、一貫したストーリーを構築する。深掘りに動じない論理が完成します。",
  },
  {
    number: "03",
    title: "PREP法で1分以内に話す練習をする",
    description:
      "結論→理由→具体例→再結論の順で声に出して練習する。録音して聞き返すと改善点が見えてきます。",
  },
  {
    number: "04",
    title: "清潔感・明るい挨拶・元気な返事",
    description:
      "最後はこれが一番効く。どんなに回答が完璧でも、第一印象と態度が評価の土台になります。",
  },
];

function parseChecks(raw: string | undefined): boolean[] {
  if (!raw) return [false, false, false, false];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 4) return parsed;
  } catch {
    /* ignore */
  }
  return [false, false, false, false];
}

export default function Section10Action({ data, onChange }: Section10Props) {
  const checks = parseChecks(data["action_checks"]);
  const completedCount = checks.filter(Boolean).length;

  const toggleCheck = (index: number) => {
    const updated = [...checks];
    updated[index] = !updated[index];
    onChange("action_checks", JSON.stringify(updated));
  };

  return (
    <SectionWrapper id="section-10" number="10" title="まとめ：今日から始めるアクション" bg="navy">
      <div className="mb-8">
        <p className="text-white/80 text-sm mb-2">
          準備の進捗 {completedCount} / {actions.length}
        </p>
        <div className="h-2 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#F39200] transition-all duration-500"
            style={{ width: `${(completedCount / actions.length) * 100}%` }}
          />
        </div>
      </div>

      <div>
        {actions.map((action, index) => {
          const checked = checks[index];
          return (
            <label
              key={action.number}
              className="bg-white/10 backdrop-blur rounded-xl p-5 mb-4 flex gap-4 cursor-pointer block"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleCheck(index)}
                className="w-5 h-5 accent-[#F39200] mt-1 shrink-0"
              />
              <div className={checked ? "line-through opacity-60" : ""}>
                <p className="text-[#F39200] font-black text-sm">ACTION {action.number}</p>
                <p className="text-white font-bold">{action.title}</p>
                <p className="text-white/80 text-sm mt-2">{action.description}</p>
              </div>
            </label>
          );
        })}
      </div>

      <div className="text-center mt-12">
        <p className="text-white/80">基礎がしっかりしていれば、面接は怖くない。</p>
        <p className="text-xl font-bold text-white mt-2">自信を持って臨もう！</p>
        <p className="text-white/80 mt-6">明るく、元気よく、対話を楽しもう。</p>
        <p className="text-white/80">
          面接は「審査される場」ではなく、「未来を共に描くプレゼンの場」だ。
        </p>
      </div>
    </SectionWrapper>
  );
}
