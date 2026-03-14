import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const GROUPS = [
  {
    name: "書類作成",
    sortOrder: 1,
    categories: ["履歴書作成", "職務経歴書作成", "推薦状作成", "追加情報取得文作成依頼"],
  },
  {
    name: "選考対応",
    sortOrder: 2,
    categories: ["エントリー対応", "面接対策依頼"],
  },
  {
    name: "報告",
    sortOrder: 3,
    categories: ["面談不参加共有", "内定承諾報告", "入社報告"],
  },
  {
    name: "登録依頼",
    sortOrder: 4,
    categories: ["求職者紹介のFM登録依頼", "RAエントリーのFM登録", "求人詳細＆登録依頼"],
  },
  {
    name: "その他",
    sortOrder: 5,
    categories: ["その他"],
  },
];

async function main() {
  let groupsCreated = 0;
  let groupsSkipped = 0;
  let categoriesLinked = 0;

  for (const gDef of GROUPS) {
    // グループの作成または取得
    let group = await prisma.taskCategoryGroup.findUnique({
      where: { name: gDef.name },
    });

    if (group) {
      console.log(`  グループスキップ: ${gDef.name}（既に存在）`);
      groupsSkipped++;
    } else {
      group = await prisma.taskCategoryGroup.create({
        data: { name: gDef.name, sortOrder: gDef.sortOrder },
      });
      console.log(`  グループ作成: ${gDef.name}`);
      groupsCreated++;
    }

    // カテゴリの紐づけ
    for (const catName of gDef.categories) {
      const category = await prisma.taskCategory.findFirst({
        where: { name: catName },
      });
      if (category && category.groupId !== group.id) {
        await prisma.taskCategory.update({
          where: { id: category.id },
          data: { groupId: group.id },
        });
        console.log(`    紐づけ: ${catName} → ${gDef.name}`);
        categoriesLinked++;
      }
    }
  }

  // 「その他」グループに属していないカテゴリを紐づけ
  const otherGroup = await prisma.taskCategoryGroup.findUnique({
    where: { name: "その他" },
  });
  if (otherGroup) {
    const unlinked = await prisma.taskCategory.findMany({
      where: { groupId: null },
    });
    for (const cat of unlinked) {
      await prisma.taskCategory.update({
        where: { id: cat.id },
        data: { groupId: otherGroup.id },
      });
      console.log(`    紐づけ（未分類→その他）: ${cat.name}`);
      categoriesLinked++;
    }
  }

  console.log(`\n完了: グループ作成 ${groupsCreated}件 / スキップ ${groupsSkipped}件 / カテゴリ紐づけ ${categoriesLinked}件`);
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
