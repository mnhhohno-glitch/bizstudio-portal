// 職種・業種クイズ Lv2 を教材一覧に1件追加する
// 実行: npx tsx prisma/seed-training-quiz-shokushu.ts
// url に unique 制約が無いため findFirst → update/create で upsert 相当にする（既存 seed と同じ方式）
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const MATERIAL = {
  title: "職種・業種クイズ Lv2",
  description: "求人票や経歴から職種と業種を判断する力を確認します。全問正解で合格です。",
  category: "新人研修",
  url: "/training/quiz/bizstudio_quiz_shokushu.html",
  tag: "クイズ",
  quizKey: "shokushu",
  sortOrder: 50, // 既存クイズ（10/20/30/40）の後ろ
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
