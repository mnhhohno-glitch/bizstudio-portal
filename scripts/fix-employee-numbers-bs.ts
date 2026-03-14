import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Employee model has employeeNumber as String
  const employees = await prisma.employee.findMany();

  let fixed = 0;
  for (const emp of employees) {
    if (emp.employeeNumber.startsWith("BS")) {
      const newNum = emp.employeeNumber.replace(/^BS/, "");
      await prisma.employee.update({
        where: { id: emp.id },
        data: { employeeNumber: newNum },
      });
      console.log(`  修正: ${emp.name} ${emp.employeeNumber} → ${newNum}`);
      fixed++;
    }
  }
  console.log(`\n完了: ${fixed}件のBSプレフィックスを除去`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
