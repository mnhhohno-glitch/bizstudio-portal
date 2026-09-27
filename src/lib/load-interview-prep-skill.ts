import { readFileSync } from "fs";
import { join } from "path";

// T-205: 面談準備アシスタントの指示本文を実行時に読み込む（getDailyReportSkill と同型・モジュールキャッシュ）。
// job-matching-advisor の SKILL は送らない（面談準備の材料はマイナビレジュメの文字と下調べの結果だけ）。
const SKILL_PATH = "src/skills/interview-prep/SKILL.md";
// T-205 step4: 下調べ（会社と学校のウェブ検索）用の指示本文。
const RESEARCH_PATH = "src/skills/interview-prep/RESEARCH.md";

let cached: string | null = null;
let cachedResearch: string | null = null;

function load(path: string): string {
  // 改行コードを LF に正規化して byte 固定する（プロンプトキャッシュは byte 一致が条件・罠#39）。
  return readFileSync(join(process.cwd(), path), "utf-8").replace(/\r\n/g, "\n");
}

export function getInterviewPrepSkill(): string {
  if (cached === null) cached = load(SKILL_PATH);
  return cached;
}

export function getInterviewPrepResearchSkill(): string {
  if (cachedResearch === null) cachedResearch = load(RESEARCH_PATH);
  return cachedResearch;
}
