import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// FM登録依頼のフィールド表示順（カスタムフィールドの氏名・フリガナ・郵便番号・住所はUI側で制御）
const FM_FIELD_ORDER = [
  "フルネーム",      // 1 (カスタムUI: 氏名)
  "ふりがな",        // 2 (カスタムUI: フリガナ)
  "生年月日",        // 3
  "性別",            // 4
  "電話番号",        // 5
  "メールアドレス",  // 6
  "郵便番号＆住所",  // 7 (カスタムUI: 郵便番号+住所)
  "面談予定日",      // 8
  "誰からの紹介か",  // 9
];

async function main() {
  const cat = await prisma.taskCategory.findFirst({ where: { name: "求職者紹介のFM登録依頼" } });
  if (!cat) { console.log("カテゴリなし"); return; }

  let updated = 0;
  for (let i = 0; i < FM_FIELD_ORDER.length; i++) {
    const label = FM_FIELD_ORDER[i];
    const field = await prisma.taskTemplateField.findFirst({
      where: { categoryId: cat.id, label },
    });
    if (field) {
      await prisma.taskTemplateField.update({
        where: { id: field.id },
        data: { sortOrder: i + 1 },
      });
      console.log(`  ${i + 1}. ${label}`);
      updated++;
    } else {
      console.log(`  スキップ: ${label}（フィールドなし）`);
    }
  }

  console.log(`\n完了: ${updated}件のsortOrderを更新`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
