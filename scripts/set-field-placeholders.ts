import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const UPDATES = [
  { category: "求職者紹介のFM登録依頼", field: "電話番号", placeholder: "080-0000-0000" },
  { category: "面接対策依頼", field: "選考求人URL", placeholder: null, newLabel: "選考求人情報" },
  { category: "内定承諾報告", field: "対象者フルネーム", placeholder: null, newLabel: "対象者" },
  // 面談不参加共有に面談時刻フィールドを追加
];

async function main() {
  for (const { category, field, placeholder, newLabel } of UPDATES) {
    const cat = await prisma.taskCategory.findFirst({ where: { name: category } });
    if (!cat) { console.log(`  スキップ: カテゴリ「${category}」なし`); continue; }

    const f = await prisma.taskTemplateField.findFirst({ where: { categoryId: cat.id, label: field } });
    if (!f) { console.log(`  スキップ: フィールド「${field}」なし（${category}）`); continue; }

    const data: Record<string, unknown> = {};
    if (placeholder !== undefined) data.placeholder = placeholder;
    if (newLabel) data.label = newLabel;

    if (Object.keys(data).length > 0) {
      await prisma.taskTemplateField.update({ where: { id: f.id }, data });
      console.log(`  更新: ${category} > ${field}${newLabel ? ` → ${newLabel}` : ""}${placeholder ? ` (placeholder: ${placeholder})` : ""}`);
    }
  }

  // 面談不参加共有に「面談時刻」フィールドを追加（なければ）
  const mendanCat = await prisma.taskCategory.findFirst({ where: { name: "面談不参加共有" } });
  if (mendanCat) {
    const existing = await prisma.taskTemplateField.findFirst({
      where: { categoryId: mendanCat.id, label: "面談時刻" },
    });
    if (!existing) {
      // 面談日のsortOrderの直後に入れる
      const mendanDateField = await prisma.taskTemplateField.findFirst({
        where: { categoryId: mendanCat.id, label: "面談日" },
      });
      // 面談日フィールドの description を設定
      if (mendanDateField) {
        await prisma.taskTemplateField.update({
          where: { id: mendanDateField.id },
          data: { description: "面談日と時刻を選択してください" },
        });
        console.log("  更新: 面談不参加共有 > 面談日に注釈設定");
      }
    }
  }

  console.log("\n完了");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
