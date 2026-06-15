import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function check() {
  const total = await prisma.candidate.count();
  console.log("全Candidate数:", total);

  const byRoute = await prisma.candidate.groupBy({
    by: ["applicationRoute"],
    _count: { id: true },
  });
  console.log("\napplicationRoute別:");
  byRoute.forEach((r) => console.log(" ", r.applicationRoute ?? "(null)", ":", r._count.id));

  const scoutTotal = await prisma.candidate.count({
    where: { applicationRoute: "スカウト" },
  });
  console.log("\nスカウト全件:", scoutTotal);

  const scoutSince = await prisma.candidate.count({
    where: { applicationRoute: "スカウト", createdAt: { gte: new Date("2026-01-11") } },
  });
  console.log("スカウト2026/1/11以降:", scoutSince);

  const scoutLinked = await prisma.candidate.count({
    where: { applicationRoute: "スカウト", scoutDeliverySlotId: { not: null } },
  });
  console.log("スカウトかつ紐付け済み:", scoutLinked);

  const oldest = await prisma.candidate.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  const newest = await prisma.candidate.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  console.log("\n最古:", oldest?.createdAt?.toISOString());
  console.log("最新:", newest?.createdAt?.toISOString());

  await prisma.$disconnect();
  await pool.end();
}

check().catch((e) => {
  console.error(e);
  process.exit(1);
});
