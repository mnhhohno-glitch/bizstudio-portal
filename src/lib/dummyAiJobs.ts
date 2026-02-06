export type AiJobStatus = "running" | "done" | "failed" | "queued";

export type DummyAiJob = {
  id: string;
  createdAt: string; // ISO
  type: "求人AI抽出" | "面接資料生成";
  target: string; // 例: 求人#123
  status: AiJobStatus;
  actorName: string;
  progress?: number; // running時
  summary?: string;  // done時の結果要約（ダミー）
};

export const DUMMY_AI_JOBS: DummyAiJob[] = [
  {
    id: "JOB-000123",
    createdAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    type: "求人AI抽出",
    target: "求人#123",
    status: "running",
    actorName: "将幸",
    progress: 34,
  },
  {
    id: "JOB-000122",
    createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    type: "面接資料生成",
    target: "候補者#88",
    status: "queued",
    actorName: "将幸",
    progress: 0,
  },
  {
    id: "JOB-000121",
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    type: "求人AI抽出",
    target: "求人#121",
    status: "done",
    actorName: "将幸",
    summary: "求人票から要件・魅力・注意点を抽出しました（ダミー）。",
  },
  {
    id: "JOB-000120",
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    type: "面接資料生成",
    target: "候補者#72",
    status: "failed",
    actorName: "将幸",
    summary: "生成に失敗しました（ダミー）。",
  },
];
