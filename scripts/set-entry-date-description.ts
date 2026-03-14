import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const cat = await prisma.taskCategory.findFirst({ where: { name: "エントリー対応" } });
  if (!cat) { console.log("カテゴリ「エントリー対応」が見つかりません"); return; }

  const field = await prisma.taskTemplateField.findFirst({
    where: { categoryId: cat.id, label: "エントリー日" },
  });
  if (!field) { console.log("フィールド「エントリー日」が見つかりません"); return; }

  await prisma.taskTemplateField.update({
    where: { id: field.id },
    data: { description: "対象エントリーのファイルメーカーエントリー日を選択してください" },
  });
  console.log("完了: エントリー日に注釈を設定しました");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
