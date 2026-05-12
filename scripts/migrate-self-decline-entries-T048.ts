/**
 * T-048: 本人辞退 (entryFlagDetail) で isActive=true のままになっている
 * エントリーを isActive=false に一括更新する。
 *
 * Usage:
 *   railway run npx tsx scripts/migrate-self-decline-entries-T048.ts          # dry-run
 *   railway run npx tsx scripts/migrate-self-decline-entries-T048.ts --execute # 実行
 *
 * Idempotent: 既に isActive=false のレコードは対象外 (findMany 条件で除外済)。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const SELF_DECLINE_DETAILS = ["本人辞退", "本人辞退_他社決", "本人辞退_自社他"];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const isExecute = process.argv.includes("--execute");
  const mode = isExecute ? "EXECUTE" : "DRY-RUN";

  console.log(`[T-048 Migration] Mode: ${mode}`);
  console.log(`[T-048 Migration] Target: entryFlagDetail IN (${SELF_DECLINE_DETAILS.join(", ")}) AND isActive=true`);
  console.log("");

  const targets = await prisma.jobEntry.findMany({
    where: {
      entryFlagDetail: { in: SELF_DECLINE_DETAILS },
      isActive: true,
    },
    select: {
      id: true,
      candidate: { select: { candidateNumber: true, name: true } },
      companyName: true,
      jobTitle: true,
      entryFlagDetail: true,
      entryDate: true,
      personFlag: true,
      companyFlag: true,
    },
    orderBy: [
      { candidate: { candidateNumber: "asc" } },
      { entryDate: "desc" },
    ],
  });

  console.log(`Found ${targets.length} entries with isActive=true but entryFlagDetail is self-decline`);
  console.log("");

  for (const t of targets) {
    const cn = t.candidate?.candidateNumber ?? "?";
    const nm = t.candidate?.name ?? "?";
    const date = t.entryDate ? new Date(t.entryDate).toLocaleDateString("sv-SE") : "?";
    console.log(`  - [${cn}] ${nm} / ${t.companyName} / detail=${t.entryFlagDetail} / personFlag=${t.personFlag ?? "(none)"} / companyFlag=${t.companyFlag ?? "(none)"} / entryDate=${date}`);
  }
  console.log("");

  if (!isExecute) {
    console.log("[DRY-RUN] No changes made. Re-run with --execute to apply isActive=false.");
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  const ids = targets.map((t) => t.id);
  const result = await prisma.jobEntry.updateMany({
    where: { id: { in: ids } },
    data: { isActive: false },
  });

  console.log(`[EXECUTE] Updated ${result.count} entries to isActive=false`);
  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
