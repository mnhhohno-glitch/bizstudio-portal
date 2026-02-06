export type AiJobStatus = "completed" | "processing" | "failed";

export type DummyAiJob = {
  id: string;
  executedAt: string; // ISO
  candidateName: string; // 求職者名
  caName: string; // 担当CA
  jobDb: string; // 求人DB
  areas: string[]; // 対象エリア
  jobCount: number; // 求人数
  status: AiJobStatus;
};

export const DUMMY_AI_JOBS: DummyAiJob[] = [
  {
    id: "AJ-2024-001",
    executedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    candidateName: "田中 太郎",
    caName: "山田 花子",
    jobDb: "リクナビNEXT",
    areas: ["東京都", "神奈川県"],
    jobCount: 45,
    status: "processing",
  },
  {
    id: "AJ-2024-002",
    executedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    candidateName: "佐藤 一郎",
    caName: "鈴木 次郎",
    jobDb: "マイナビ転職",
    areas: ["大阪府", "兵庫県", "京都府"],
    jobCount: 128,
    status: "completed",
  },
  {
    id: "AJ-2024-003",
    executedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    candidateName: "高橋 美咲",
    caName: "山田 花子",
    jobDb: "doda",
    areas: ["愛知県"],
    jobCount: 67,
    status: "completed",
  },
  {
    id: "AJ-2024-004",
    executedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    candidateName: "伊藤 健二",
    caName: "鈴木 次郎",
    jobDb: "リクナビNEXT",
    areas: ["福岡県", "熊本県"],
    jobCount: 0,
    status: "failed",
  },
  {
    id: "AJ-2024-005",
    executedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    candidateName: "渡辺 真由",
    caName: "山田 花子",
    jobDb: "エン転職",
    areas: ["北海道"],
    jobCount: 34,
    status: "completed",
  },
  {
    id: "AJ-2024-006",
    executedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    candidateName: "中村 大輔",
    caName: "鈴木 次郎",
    jobDb: "マイナビ転職",
    areas: ["東京都", "千葉県", "埼玉県"],
    jobCount: 210,
    status: "completed",
  },
];
