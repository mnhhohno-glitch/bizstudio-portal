import { existsSync, readFileSync } from "fs";
import { join } from "path";

const SKILL_DIR = "src/skills/job-matching-advisor";
const SKILL_FILE = "SKILL.md";
const MIDDLE_CAREER_FILE = "references/middle-career.md";

let cachedSkill: string | null = null;

function loadSkillFromDisk(): string {
  const root = process.cwd();
  const skillPath = join(root, SKILL_DIR, SKILL_FILE);
  const middleCareerPath = join(root, SKILL_DIR, MIDDLE_CAREER_FILE);

  console.log("[SKILL] process.cwd():", root);
  console.log("[SKILL] Loading SKILL.md from:", skillPath);
  console.log("[SKILL] SKILL.md exists:", existsSync(skillPath));
  console.log("[SKILL] middle-career.md path:", middleCareerPath);
  console.log("[SKILL] middle-career.md exists:", existsSync(middleCareerPath));

  const skillBody = readFileSync(skillPath, "utf-8");
  console.log("[SKILL] SKILL.md length:", skillBody.length);
  console.log("[SKILL] SKILL.md contains '19.2%':", skillBody.includes("19.2%"));
  console.log("[SKILL] SKILL.md contains 'Aランクでも進まない理由':", skillBody.includes("Aランクでも進まない理由"));
  console.log("[SKILL] SKILL.md contains '実績ベースでの予測精度':", skillBody.includes("実績ベースでの予測精度"));
  console.log("[SKILL] SKILL.md first 200 chars:", skillBody.substring(0, 200));

  let middleCareerBody = "";
  try {
    middleCareerBody = readFileSync(middleCareerPath, "utf-8");
    console.log("[SKILL] middle-career.md length:", middleCareerBody.length);
  } catch (e) {
    console.warn("[SKILL] middle-career.md not found:", e);
  }

  if (!middleCareerBody) {
    return skillBody;
  }

  const combined =
    skillBody +
    "\n\n---\n\n" +
    "# 付録: ミドル層（35歳以上）詳細ガイド\n\n" +
    "（上記 Phase 4 で参照されている `references/middle-career.md` の本文）\n\n" +
    middleCareerBody;

  console.log("[SKILL] Combined skill length:", combined.length);

  return combined;
}

export function getJobMatchingSkill(): string {
  if (cachedSkill === null) {
    cachedSkill = loadSkillFromDisk();
  }
  return cachedSkill;
}
