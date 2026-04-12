// 求人種別マスター（固定リスト）
export const JOB_TYPE_OPTIONS = [
  "HP",
  "直接求人",
  "事務局求人",
  "share求人",
  "DODA求人",
  "RA",
  "アライアンス(70%)",
  "アライアンス(80%)",
  "アライアンス(85%)",
  "doda掲載求人",
  "パーソル求人",
] as const;

export type JobType = (typeof JOB_TYPE_OPTIONS)[number];

// エントリー媒体（切替時に選べる媒体）
export const ENTRY_ROUTE_OPTIONS = [
  "自社",
  "Circus",
  "マイナビJOB",
  "エーナビ",
  "クラウドエージェント",
  "agentbank",
  "HITO-Link",
] as const;

export type EntryRoute = (typeof ENTRY_ROUTE_OPTIONS)[number];

// 求人経路ランク（媒体 → ランク番号）
// 求人ID生成ルール: {ランク}_{媒体別求人番号}_{都道府県コード}
export const ROUTE_RANK_MAP: Record<string, number> = {
  "自社": 1,
  "Circus": 2,
  "マイナビJOB": 3,
  "エーナビ": 4,
  "クラウドエージェント": 5,
  "agentbank": 6,
  "HITO-Link": 7,
};

// 都道府県コード（求人ID末尾に付与）
export const PREFECTURE_CODES: { label: string; code: number }[] = [
  { label: "北海道", code: 10 },
  { label: "青森県", code: 11 },
  { label: "岩手県", code: 12 },
  { label: "宮城県", code: 13 },
  { label: "秋田県", code: 14 },
  { label: "山形県", code: 15 },
  { label: "福島県", code: 16 },
  { label: "茨城県", code: 17 },
  { label: "栃木県", code: 18 },
  { label: "群馬県", code: 19 },
  { label: "東京都", code: 20 },
  { label: "神奈川県", code: 21 },
  { label: "埼玉県", code: 22 },
  { label: "千葉県", code: 23 },
  { label: "新潟県", code: 24 },
  { label: "山梨県", code: 25 },
  { label: "長野県", code: 26 },
  { label: "富山県", code: 27 },
  { label: "石川県", code: 28 },
  { label: "福井県", code: 29 },
  { label: "愛知県", code: 30 },
  { label: "静岡県", code: 31 },
  { label: "岐阜県", code: 32 },
  { label: "三重県", code: 33 },
  { label: "大阪府", code: 34 },
  { label: "兵庫県", code: 35 },
  { label: "京都府", code: 36 },
  { label: "滋賀県", code: 37 },
  { label: "奈良県", code: 38 },
  { label: "和歌山県", code: 39 },
  { label: "広島県", code: 40 },
  { label: "鳥取県", code: 41 },
  { label: "島根県", code: 42 },
  { label: "岡山県", code: 43 },
  { label: "山口県", code: 44 },
  { label: "香川県", code: 45 },
  { label: "徳島県", code: 46 },
  { label: "愛媛県", code: 47 },
  { label: "高知県", code: 48 },
  { label: "福岡県", code: 49 },
  { label: "熊本県", code: 50 },
  { label: "佐賀県", code: 51 },
  { label: "長崎県", code: 52 },
  { label: "大分県", code: 53 },
  { label: "宮崎県", code: 54 },
  { label: "鹿児島県", code: 55 },
  { label: "沖縄県", code: 56 },
];

// 求人ID生成ヘルパー
// 未入力部分は "__" で表示（プレビュー用）
export function buildEntryJobId(
  route: string | null | undefined,
  jobNumber: string | null | undefined,
  prefectureCode: number | null | undefined,
): string {
  const rank = route && ROUTE_RANK_MAP[route] ? String(ROUTE_RANK_MAP[route]) : "_";
  const num = jobNumber && jobNumber.trim() ? jobNumber.trim() : "__";
  const pref = prefectureCode != null ? String(prefectureCode) : "__";
  return `${rank}_${num}_${pref}`;
}
