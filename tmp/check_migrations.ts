import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
(async () => {
  const rows: { migration_name: string; finished_at: Date | null }[] = await prisma.$queryRawUnsafe(
    `SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE migration_name LIKE '%no_application%' OR migration_name LIKE '%20260603%' ORDER BY started_at`
  );
  console.log(JSON.stringify(rows, null, 2));
  await prisma.$disconnect();
  await pool.end();
})();
