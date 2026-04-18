import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const hidden = await prisma.hiddenJobIntroduction.findMany({
    where: { candidateId: "cmnfvise700081dml1b4fw1qt" },
    orderBy: { createdAt: "desc" },
  });
  console.log("=== HiddenJobIntroduction ===");
  console.log("件数: " + hidden.length);
  for (const h of hidden) {
    console.log("  id=" + h.id + " externalJobId=" + h.externalJobId + " createdAt=" + h.createdAt.toISOString());
  }

  const cand = await prisma.candidate.findUnique({
    where: { id: "cmnfvise700081dml1b4fw1qt" },
    select: { candidateNumber: true, name: true },
  });
  console.log("");
  console.log("候補者: " + cand?.name + " No." + cand?.candidateNumber);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
