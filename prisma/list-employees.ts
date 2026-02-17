import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const employees = await prisma.employee.findMany({
    orderBy: { employeeNumber: "asc" },
  });

  console.log("=== Current Employees ===");
  for (const emp of employees) {
    console.log(`${emp.employeeNumber}: ${emp.name} (${emp.status})`);
  }
  console.log(`Total: ${employees.length}`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
