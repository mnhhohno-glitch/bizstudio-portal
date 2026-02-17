import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const employees = await prisma.employee.findMany();
  console.log("=== Employees ===");
  for (const emp of employees) {
    console.log(`${emp.employeeNumber} -> ${emp.name} (id: ${emp.id})`);
  }

  // 求職者の担当CA状況をサンプルで確認
  const candidates = await prisma.candidate.findMany({
    take: 10,
    orderBy: { candidateNumber: "desc" },
    include: { employee: true },
  });
  console.log("\n=== Sample Candidates (top 10) ===");
  for (const c of candidates) {
    console.log(`${c.candidateNumber}: ${c.name} -> CA: ${c.employee?.name || "未設定"} (employeeId: ${c.employeeId || "null"})`);
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
