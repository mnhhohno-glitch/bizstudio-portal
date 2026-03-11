import type { Q1Route } from "@/types/jimu";

export const Q1_OPTIONS: {
  id: string;
  label: string;
  route: Q1Route;
  hasTextInput?: boolean;
}[] = [
  {
    id: "condition",
    label: "土日休み・残業の少なさなど、働き方の条件が合うと思った",
    route: "condition",
  },
  {
    id: "personality",
    label: "几帳面・コツコツ作業が得意で、自分に向いていると思った",
    route: "personality",
  },
  {
    id: "support",
    label: "誰かをサポートする・縁の下で支える仕事がしたい",
    route: "support",
  },
  {
    id: "other",
    label: "その他",
    route: "other",
    hasTextInput: true,
  },
];

export const Q2_OPTIONS: Record<
  string,
  {
    question: string;
    options: {
      id: string;
      label: string;
      score: { general: number; sales: number };
      hasTextInput?: boolean;
    }[];
  } | null
> = {
  condition: {
    question: "働き方を大切にしたいと思ったのは、どんな気持ちからですか？",
    options: [
      { id: "c1", label: "自分のペースで、着実に仕事をやり遂げたいから", score: { general: 1, sales: 0 } },
      { id: "c2", label: "特定の誰かや組織を、しっかり支えたいから", score: { general: 0, sales: 1 } },
      { id: "c3", label: "無理なく長く続けられる仕事で、着実に成長したいから", score: { general: 0, sales: 0 } },
      { id: "c4", label: "その他", score: { general: 0, sales: 0 }, hasTextInput: true },
    ],
  },
  personality: {
    question: "几帳面・コツコツが活きたと感じた体験はどれに近いですか？",
    options: [
      { id: "p1", label: "書類や資料を整理したら「助かった」と言われた", score: { general: 1, sales: 0 } },
      { id: "p2", label: "自分の準備・段取りでチームや誰かがうまく動けた", score: { general: 0, sales: 1 } },
      { id: "p3", label: "ミスなくやり遂げた・効率よくこなした達成感があった", score: { general: 1, sales: 0 } },
      { id: "p4", label: "その他", score: { general: 0, sales: 0 }, hasTextInput: true },
    ],
  },
  support: {
    question: "サポートのイメージは、どちらに近いですか？",
    options: [
      { id: "s1", label: "書類・データを正確に管理して、組織全体を裏で支えたい", score: { general: 2, sales: 0 } },
      { id: "s2", label: "営業担当が動きやすいよう、受発注・調整をこなしたい", score: { general: 0, sales: 2 } },
      { id: "s3", label: "会社全体の業務が円滑に回るよう、縁の下で整えたい", score: { general: 1, sales: 0 } },
      { id: "s4", label: "その他", score: { general: 0, sales: 0 }, hasTextInput: true },
    ],
  },
  other: null,
};

export const Q3_OPTIONS = {
  question: "仕事でいちばん「やった！」と感じるのは、どんな瞬間ですか？",
  options: [
    { id: "q3_1", label: "書類やデータに一切ミスがなく、完璧に仕上がったとき", score: { general: 2, sales: 0 } },
    { id: "q3_2", label: "自分のサポートで、営業や周りが助かったと言ってくれたとき", score: { general: 0, sales: 2 } },
    { id: "q3_3", label: "複雑なことを整理して、周りが動きやすくなったとき", score: { general: 1, sales: 0 } },
    { id: "q3_4", label: "その他", score: { general: 0, sales: 0 }, hasTextInput: true },
  ],
};

export const Q4_OPTIONS: Record<
  string,
  {
    question: string;
    options: {
      id: string;
      label: string;
      yarigaiWord: string;
      hasTextInput?: boolean;
    }[];
  }
> = {
  general: {
    question: "書類やデータを正確に管理することで、誰に貢献できると思いますか？",
    options: [
      { id: "g1", label: "経営・管理部門が正確な情報で判断できるよう支える", yarigaiWord: "精度で組織を動かす" },
      { id: "g2", label: "現場スタッフが書類トラブルなく仕事に集中できるよう支える", yarigaiWord: "縁の下の正確さ" },
      { id: "g3", label: "会社の信頼・コンプライアンスを守ることに貢献する", yarigaiWord: "誠実さで会社を守る" },
      { id: "g4", label: "その他", yarigaiWord: "", hasTextInput: true },
    ],
  },
  sales: {
    question: "営業をサポートすることで、何を一番感じたいですか？",
    options: [
      { id: "s1", label: "自分の仕事が受注・数字につながった実感", yarigaiWord: "結果につながる縁の下" },
      { id: "s2", label: "お客様への対応が早く正確になって信頼につながった実感", yarigaiWord: "顧客満足を支える" },
      { id: "s3", label: "チームの一員として目標達成した喜び", yarigaiWord: "チームで勝つサポート力" },
      { id: "s4", label: "その他", yarigaiWord: "", hasTextInput: true },
    ],
  },
};
