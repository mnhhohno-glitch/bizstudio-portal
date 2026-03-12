export const Q1_OPTIONS = [
  {
    id: "condition",
    label: "土日休み・残業の少なさなど、働き方の条件が合うと思った",
    isCondition: true,
  },
  {
    id: "personality",
    label: "几帳面・コツコツ作業が得意で、自分に向いていると思った",
  },
  {
    id: "support",
    label: "誰かをサポートする・縁の下で支える仕事がしたい",
  },
  {
    id: "other",
    label: "その他",
    hasTextInput: true,
  },
];

export const Q2_UNIFIED = {
  question: "事務の仕事で、あなたが一番大切にしたいことはどれですか？",
  options: [
    { id: "u1", label: "正確さ。ミスなく仕事をやり遂げたい" },
    { id: "u2", label: "スピード。頼まれたことに素早く対応したい" },
    { id: "u3", label: "気配り。周りが動きやすいよう先回りしたい" },
    { id: "u4", label: "安定。無理なく長く続けられる働き方をしたい" },
    { id: "u5", label: "その他", hasTextInput: true },
  ],
};
