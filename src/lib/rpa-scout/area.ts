// RPAスカウト検索条件のエリア定義（マイナビの地域区分に合わせる）

export type AreaGroup = {
  region: string;
  prefectures: string[];
};

// 東日本 = 北海道 / 東北 / 関東 / 甲信越
export const EAST_AREA_GROUPS: AreaGroup[] = [
  { region: "北海道", prefectures: ["北海道"] },
  { region: "東北", prefectures: ["青森", "岩手", "宮城", "秋田", "山形", "福島"] },
  { region: "関東", prefectures: ["茨城", "栃木", "群馬", "埼玉", "千葉", "東京", "神奈川"] },
  { region: "甲信越", prefectures: ["新潟", "山梨", "長野"] },
];

// 西日本 = 北陸 / 東海 / 関西 / 中国 / 四国 / 九州
export const WEST_AREA_GROUPS: AreaGroup[] = [
  { region: "北陸", prefectures: ["富山", "石川", "福井"] },
  { region: "東海", prefectures: ["岐阜", "静岡", "愛知", "三重"] },
  { region: "関西", prefectures: ["滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山"] },
  { region: "中国", prefectures: ["鳥取", "島根", "岡山", "広島", "山口"] },
  { region: "四国", prefectures: ["徳島", "香川", "愛媛", "高知"] },
  {
    region: "九州",
    prefectures: ["福岡", "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄"],
  },
];

export const ALL_AREA_GROUPS: AreaGroup[] = [...EAST_AREA_GROUPS, ...WEST_AREA_GROUPS];

export const EAST_PREFECTURES: string[] = EAST_AREA_GROUPS.flatMap((g) => g.prefectures);
export const WEST_PREFECTURES: string[] = WEST_AREA_GROUPS.flatMap((g) => g.prefectures);
export const ALL_PREFECTURES: string[] = [...EAST_PREFECTURES, ...WEST_PREFECTURES];

export type AreaType = "EAST" | "WEST" | "NATIONWIDE" | "PREFECTURES";

export const AREA_TYPE_LABELS: Record<AreaType, string> = {
  EAST: "東日本",
  WEST: "西日本",
  NATIONWIDE: "全国",
  PREFECTURES: "県指定",
};

// 希望勤務地の選択肢（「首都圏」はマイナビ側の選択肢としてそのまま扱う）
export const WORK_LOCATION_OPTIONS: string[] = ["首都圏", ...ALL_PREFECTURES];

// 希望勤務地のデフォルト
export const DEFAULT_WORK_LOCATIONS: string[] = ["首都圏", "愛知", "大阪", "兵庫", "京都"];
