// クイズ Ver.6 総合（中級）を教材一覧に1件追加する（T-192）
// 実行: npx tsx prisma/seed-training-quiz-sougou6.ts
// url に unique 制約が無いため findFirst → update/create で upsert 相当にする（既存 seed と同じ方式）
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const MATERIAL = {
  title: "クイズ Ver.6 総合（中級）",
  description: "Day1〜Day5 の総合確認。求人票・求職者の条件を前にした判断を問う（選択式38問）。",
  category: "新人研修",
  url: "/training/quiz/bizstudio_quiz_sougou6.html",
  tag: "クイズ",
  quizKey: "sougou6",
  sortOrder: 60, // 既存教材の最大 sortOrder（50）＋10
};

async function main() {
  const existing = await prisma.trainingMaterial.findFirst({ where: { url: MATERIAL.url } });

  if (existing) {
    const updated = await prisma.trainingMaterial.update({
      where: { id: existing.id },
      data: {
        title: MATERIAL.title,
        description: MATERIAL.description,
        category: MATERIAL.category,
        tag: MATERIAL.tag,
        quizKey: MATERIAL.quizKey,
        sortOrder: MATERIAL.sortOrder,
      },
    });
    console.log(`更新: ${updated.title} (id=${updated.id}, quizKey=${updated.quizKey})`);
  } else {
    const created = await prisma.trainingMaterial.create({ data: MATERIAL });
    console.log(`追加: ${created.title} (id=${created.id}, quizKey=${created.quizKey})`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
