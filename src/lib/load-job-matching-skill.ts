import { readFileSync } from "fs";
import { join } from "path";

const SKILL_DIR = "src/skills/job-matching-advisor";
const SKILL_FILE = "SKILL.md";
const MIDDLE_CAREER_FILE = "references/middle-career.md";

let cachedSkill: string | null = null;

function loadSkillFromDisk(): string {
  const root = process.cwd();
  const skillPath = join(root, SKILL_DIR, SKILL_FILE);
  const middleCareerPath = join(root, SKILL_DIR, MIDDLE_CAREER_FILE);

  const skillBody = readFileSync(skillPath, "utf-8");

  let middleCareerBody = "";
  try {
    middleCareerBody = readFileSync(middleCareerPath, "utf-8");
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

  return combined;
}

export function getJobMatchingSkill(): string {
  if (cachedSkill === null) {
    cachedSkill = loadSkillFromDisk();
  }
  return cachedSkill;
}
