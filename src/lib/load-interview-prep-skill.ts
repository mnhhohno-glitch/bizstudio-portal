import { readFileSync } from "fs";
import { join } from "path";

// T-205: 面談準備アシスタントの指示本文を実行時に読み込む（getDailyReportSkill と同型・モジュールキャッシュ）。
// job-matching-advisor の SKILL は送らない（面談準備の材料はマイナビレジュメの文字だけ）。
const SKILL_PATH = "src/skills/interview-prep/SKILL.md";

let cached: string | null = null;

export function getInterviewPrepSkill(): string {
  if (cached === null) {
    // 改行コードを LF に正規化して byte 固定する（プロンプトキャッシュは byte 一致が条件・罠#39）。
    cached = readFileSync(join(process.cwd(), SKILL_PATH), "utf-8").replace(/\r\n/g, "\n");
  }
  return cached;
}
