import { readFileSync } from "fs";
import { join } from "path";

// T-069③：日報アドバイザー skill を実行時に読み込む（getJobMatchingSkill 同型・モジュールキャッシュ）。
const SKILL_PATH = "src/skills/daily-report-advisor/SKILL.md";

let cached: string | null = null;

export function getDailyReportSkill(): string {
  if (cached === null) {
    cached = readFileSync(join(process.cwd(), SKILL_PATH), "utf-8");
  }
  return cached;
}
