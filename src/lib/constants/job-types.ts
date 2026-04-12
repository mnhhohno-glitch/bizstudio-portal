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
  "HITO-Link",
  "Circus",
  "マイナビJOB",
  "エーナビ",
  "クラウドエージェント",
  "agentbank",
] as const;

export type EntryRoute = (typeof ENTRY_ROUTE_OPTIONS)[number];
