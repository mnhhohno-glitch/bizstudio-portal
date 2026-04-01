import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as XLSX from "xlsx";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function importBirthdays() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/import-birthdays.ts <path-to-xlsx>");
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

  let updated = 0;
  let notFound = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const candidateNumber = String(row["求職者NO"]);
    const birthdayRaw = row["生年月日"];

    let birthday: Date | null = null;
    if (birthdayRaw) {
      if (typeof birthdayRaw === "number") {
        // Excel serial date number — use UTC noon to prevent JST timezone shift
        const parsed = XLSX.SSF.parse_date_code(birthdayRaw);
        birthday = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, 12, 0, 0));
      } else {
        const dt = new Date(birthdayRaw);
        // Re-create at UTC noon to prevent timezone shift
        birthday = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 12, 0, 0));
      }

      if (isNaN(birthday.getTime())) {
        console.error(`Invalid date for ${candidateNumber}: ${birthdayRaw}`);
        errors++;
        continue;
      }
    } else {
      skipped++;
      continue;
    }

    try {
      const result = await prisma.candidate.updateMany({
        where: { candidateNumber },
        data: { birthday },
      });

      if (result.count > 0) {
        updated++;
      } else {
        notFound++;
      }
    } catch (error) {
      console.error(`Error updating ${candidateNumber}:`, error);
      errors++;
    }
  }

  console.log(`\nImport complete:`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Not found: ${notFound}`);
  console.log(`  Skipped (no birthday): ${skipped}`);
  console.log(`  Errors: ${errors}`);

  await prisma.$disconnect();
  await pool.end();
}

importBirthdays();
