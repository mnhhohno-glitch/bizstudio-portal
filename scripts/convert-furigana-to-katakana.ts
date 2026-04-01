import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function toKatakana(str: string): string {
  return str.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

function hasHiragana(str: string): boolean {
  return /[\u3041-\u3096]/.test(str);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const candidates = await prisma.candidate.findMany({
    where: { nameKana: { not: null } },
    select: { id: true, nameKana: true, name: true },
  });

  console.log(`Total candidates with nameKana: ${candidates.length}`);

  const toConvert = candidates.filter((c) => c.nameKana && hasHiragana(c.nameKana));
  console.log(`Candidates with hiragana to convert: ${toConvert.length}`);

  if (dryRun) {
    console.log("\n[DRY RUN] No updates will be made.\n");
    for (const c of toConvert.slice(0, 10)) {
      console.log(`  ${c.name}: "${c.nameKana}" → "${toKatakana(c.nameKana!)}"`);
    }
    if (toConvert.length > 10) console.log(`  ... and ${toConvert.length - 10} more`);
  } else {
    let updated = 0;
    for (const c of toConvert) {
      const converted = toKatakana(c.nameKana!);
      await prisma.candidate.update({
        where: { id: c.id },
        data: { nameKana: converted },
      });
      updated++;
    }
    console.log(`\nConverted: ${updated} / ${candidates.length}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
