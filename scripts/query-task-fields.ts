import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const ids = [
    "cmmolxn1v0026po4f0olekfps", // 履歴書
    "cmmolxv0g002qpo4fazblhj0f", // 職務経歴書
    "cmmolxxtl002xpo4f1mf6srei", // 推薦状
    "cmoal05cp002r1dsxyokhti3i", // 3点セット
  ];
  for (const id of ids) {
    const cat = await prisma.taskCategory.findUnique({ where: { id }, select: { id: true, name: true } });
    console.log(`\n=== ${cat?.name} === ${id}`);
    const fields = await prisma.taskTemplateField.findMany({
      where: { categoryId: id },
      orderBy: { sortOrder: "asc" },
      include: { options: { orderBy: { sortOrder: "asc" } } },
    });
    if (fields.length === 0) {
      console.log("  (no fields)");
      continue;
    }
    for (const f of fields) {
      console.log(`  [${f.sortOrder}] "${f.label}" | type=${f.fieldType} | required=${f.isRequired} | placeholder="${f.placeholder || ""}" | desc="${(f.description || "").slice(0, 80)}"`);
      if (f.options.length > 0) {
        for (const o of f.options) {
          console.log(`    - [${o.sortOrder}] label="${o.label}" value="${o.value}"`);
        }
      }
    }
  }
  await prisma.$disconnect();
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
