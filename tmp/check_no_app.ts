import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
(async () => {
  const rows = await prisma.entryFlagMaster.findMany({
    where: { flagType: "entry_detail", parentFlag: "求人紹介" },
    orderBy: { sortOrder: "asc" },
  });
  console.log(JSON.stringify(rows, null, 2));
  await prisma.$disconnect();
  await pool.end();
})();
