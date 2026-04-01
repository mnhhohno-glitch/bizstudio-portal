import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as XLSX from "xlsx";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function parseExcelDate(raw: string | number): Date | null {
  let y: number, m: number, d: number;

  if (typeof raw === "number") {
    const parsed = XLSX.SSF.parse_date_code(raw);
    y = parsed.y;
    m = parsed.m;
    d = parsed.d;
  } else {
    const dt = new Date(raw);
    if (isNaN(dt.getTime())) return null;
    y = dt.getUTCFullYear();
    m = dt.getUTCMonth() + 1;
    d = dt.getUTCDate();
  }

  // Use UTC noon to prevent timezone shift (JST = UTC+9, noon UTC = 21:00 JST same day)
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filePath = args.find((a) => !a.startsWith("--"));

  if (!filePath) {
    console.error("Usage: npx tsx scripts/fix-birthdays.ts <path-to-xlsx> [--dry-run]");
    process.exit(1);
  }

  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<{
    "求職者NO": string | number;
    "求職者氏名_結合": string;
    "生年月日": string | number;
  }>(sheet);

  console.log(`Total rows: ${rows.length}`);
  if (dryRun) console.log("[DRY RUN] No updates will be made.\n");

  let updated = 0;
  let notFound = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const candidateNumber = String(row["求職者NO"]);
    const birthdayRaw = row["生年月日"];

    if (!birthdayRaw) { skipped++; continue; }

    const birthday = parseExcelDate(birthdayRaw);
    if (!birthday) {
      console.error(`Invalid date for ${candidateNumber}: ${birthdayRaw}`);
      errors++;
      continue;
    }

    if (dryRun) {
      if (updated < 5) {
        console.log(`  ${candidateNumber}: ${birthday.toISOString().slice(0, 10)}`);
      }
      updated++;
      continue;
    }

    try {
      const result = await prisma.candidate.updateMany({
        where: { candidateNumber },
        data: { birthday },
      });
      if (result.count > 0) updated++;
      else notFound++;
    } catch (e) {
      console.error(`Error updating ${candidateNumber}:`, e);
      errors++;
    }
  }

  if (dryRun && updated > 5) console.log(`  ... and ${updated - 5} more`);

  console.log(`\n${dryRun ? "[DRY RUN] " : ""}Complete:`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Not found: ${notFound}`);
  console.log(`  Skipped (no birthday): ${skipped}`);
  console.log(`  Errors: ${errors}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
