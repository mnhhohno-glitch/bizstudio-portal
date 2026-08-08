import { readFileSync } from "fs";
import { join } from "path";

// job-matching-advisor スキルの2本分離（判定用 / フル版）:
//   - SKILL.md      … 判定用。実績値・CA戦略・検証履歴を含まない（判定AIが自らの過去実績値を
//                      読んで判定を自己調整するのを防ぐ）。求人AI評価（analyze-batch）が読む。
//   - SKILL_full.md … フル版。実績値・紹介戦略・検証履歴年表入り。人間向け助言系
//                      （AIアドバイザーチャット・日報アドバイザー）が読む。
// 両版とも references/middle-career.md を付録として結合する（結合仕様は共通）。

const SKILL_DIR = "src/skills/job-matching-advisor";
const SKILL_FILE = "SKILL.md";
const SKILL_FULL_FILE = "SKILL_full.md";
const MIDDLE_CAREER_FILE = "references/middle-career.md";

// モジュールキャッシュは版ごとに独立（片方のキャッシュがもう片方に混ざらない）。
let cachedSkill: string | null = null;
let cachedSkillFull: string | null = null;

function loadSkillFromDisk(skillFile: string): string {
  const root = process.cwd();
  const skillPath = join(root, SKILL_DIR, skillFile);
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

/** 判定用版（SKILL.md）。求人AI評価（analyze-batch）用。実績値・CA戦略なし。 */
export function getJobMatchingSkill(): string {
  if (cachedSkill === null) {
    cachedSkill = loadSkillFromDisk(SKILL_FILE);
  }
  return cachedSkill;
}

/** フル版（SKILL_full.md）。AIアドバイザーチャット・日報アドバイザー用。実績値・戦略・検証履歴入り。 */
export function getJobMatchingSkillFull(): string {
  if (cachedSkillFull === null) {
    cachedSkillFull = loadSkillFromDisk(SKILL_FULL_FILE);
  }
  return cachedSkillFull;
}
