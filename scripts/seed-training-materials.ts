// 研修メニュー（社内研修）: 初期教材3件の投入
// url をキーに findFirst → update/create するため何度実行しても安全（idempotent）。
// 実行: railway ssh --service bizstudio-portal 経由で `npx tsx scripts/seed-training-materials.ts`
// （railway run はローカルの空DBに繋がるため使わない）
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type MaterialDef = {
  title: string;
  description: string;
  category: string;
  url: string;
  tag: string;
  quizKey: string;
  sortOrder: number;
};

const MATERIALS: MaterialDef[] = [
  {
    title: "基礎知識クイズ Lv1（全40問）",
    description: "転職活動の流れと用語／人材紹介の仕組み／求人票の読み方。満点になるまで繰り返す。",
    category: "新人研修",
    url: "/training/quiz/bizstudio_quiz_lv1.html",
    tag: "クイズ",
    quizKey: "lv1",
    sortOrder: 10,
  },
  {
    title: "営業職クイズ（全20問）",
    description: "お役立ちコンテンツ「営業は“売り込む仕事”だけじゃない」を読んでから挑戦。",
    category: "新人研修",
    url: "/training/quiz/bizstudio_quiz_sales.html",
    tag: "クイズ",
    quizKey: "sales",
    sortOrder: 20,
  },
  {
    title: "CA・RAクイズ（全20問）",
    description: "お役立ちコンテンツ「キャリアアドバイザー・RAという選択肢」を読んでから挑戦。",
    category: "新人研修",
    url: "/training/quiz/bizstudio_quiz_ca_ra.html",
    tag: "クイズ",
    quizKey: "ca_ra",
    sortOrder: 30,
  },
  {
    title: "求人票の読み方クイズ（全18問）",
    description:
      "必須条件と歓迎要件／チャレンジエントリー／選考難易度／見る順番。午前の研修内容の定着確認。",
    category: "新人研修",
    url: "/training/quiz/bizstudio_quiz_yomikata.html",
    tag: "クイズ",
    quizKey: "yomikata",
    sortOrder: 40,
  },
];

async function main() {
  for (const def of MATERIALS) {
    // url に unique 制約は無いため findFirst → update/create で upsert 相当を実現する
    const existing = await prisma.trainingMaterial.findFirst({
      where: { url: def.url },
    });

    if (existing) {
      const updated = await prisma.trainingMaterial.update({
        where: { id: existing.id },
        data: {
          title: def.title,
          description: def.description,
          category: def.category,
          tag: def.tag,
          quizKey: def.quizKey,
          sortOrder: def.sortOrder,
        },
      });
      console.log(`  更新: ${updated.title} (id=${updated.id}, quizKey=${updated.quizKey})`);
    } else {
      const created = await prisma.trainingMaterial.create({
        data: {
          title: def.title,
          description: def.description,
          category: def.category,
          url: def.url,
          tag: def.tag,
          quizKey: def.quizKey,
          sortOrder: def.sortOrder,
          isPublished: true,
        },
      });
      console.log(`  作成: ${created.title} (id=${created.id})`);
    }
  }

  console.log("\n完了");
}

main()
  .catch((e) => {
    console.error("エラー:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
