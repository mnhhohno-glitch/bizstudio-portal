import { GuideConfig } from "../types";

export const interviewGuideConfig: GuideConfig = {
  type: "INTERVIEW",
  title: "面接対策ガイド",
  description: "第二新卒のための「面接の本質」対策ガイド",
  sections: [
    {
      id: "career_axis",
      title: "転職軸ワークシート",
      description: "3つの問いに答えて、あなたの「軸」を言語化しよう",
      fields: [
        {
          key: "reason_for_change",
          label: "なぜ転職するのか？",
          placeholder:
            "ネガティブな理由ではなく「向かう先」として書いてみましょう",
          rows: 4,
        },
        {
          key: "work_values",
          label: "何を大切にして働きたいか？",
          placeholder:
            "あなたが仕事で「これは譲れない」と思う価値観を書いてみましょう",
          rows: 4,
        },
        {
          key: "future_vision",
          label: "どんな自分になりたいか？",
          placeholder:
            "5年後・10年後のキャリアビジョンを具体的にイメージしてみましょう",
          rows: 4,
        },
      ],
    },
    {
      id: "prep_method",
      title: "PREP法 練習シート",
      description: "自己PRをPREP法で組み立ててみよう",
      fields: [
        {
          key: "prep_point",
          label: "Point（結論）",
          placeholder: "「私の強みは〇〇です」",
          rows: 3,
        },
        {
          key: "prep_reason",
          label: "Reason（理由）",
          placeholder: "「なぜなら〜だからです」",
          rows: 3,
        },
        {
          key: "prep_example",
          label: "Example（具体例）",
          placeholder: "「例えば前職で〜」",
          rows: 4,
        },
        {
          key: "prep_conclusion",
          label: "Point（再結論）",
          placeholder: "「だから御社で〇〇できます」",
          rows: 3,
        },
      ],
    },
  ],
};
