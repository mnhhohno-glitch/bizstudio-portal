export const TARGET_AREAS = [
  "東京都",
  "神奈川県",
  "千葉県",
  "埼玉県",
  "大阪府",
  "愛知県",
  "福岡県",
  "北海道",
  "宮城県",
  "広島県",
];

export const AREA_GROUPS = [
  {
    label: "首都圏",
    prefectures: ["東京都", "神奈川県", "埼玉県", "千葉県"],
  },
  {
    label: "関西",
    prefectures: ["大阪府", "兵庫県", "京都府"],
  },
  {
    label: "東海",
    prefectures: ["愛知県", "静岡県"],
  },
] as const;

export const GROUPED_PREFECTURES = new Set<string>(
  AREA_GROUPS.flatMap((g) => [...g.prefectures])
);

export const ALL_PREFECTURES = [
  "北海道",
  "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

export const OTHER_PREFECTURES = ALL_PREFECTURES.filter(
  (p) => !GROUPED_PREFECTURES.has(p)
);
