import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as fs from "fs";
import * as iconv from "iconv-lite";
import { parse } from "csv-parse/sync";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // CSVファイルを読み込み（Shift-JIS）
  const csvPath = "./prisma/inport_kyuusyokusya.csv";
  const buffer = fs.readFileSync(csvPath);
  const content = iconv.decode(buffer, "Shift_JIS");

  // CSVをパース
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`CSV records: ${records.length}`);

  // 社員マスタを取得（社員番号 → ID のマップ）
  const employees = await prisma.employee.findMany();
  const employeeMap = new Map<string, string>();
  for (const emp of employees) {
    employeeMap.set(emp.employeeNumber, emp.id);
  }
  console.log(`Employees loaded: ${employees.length}`);

  // 既存の求職者番号を取得
  const existingCandidates = await prisma.candidate.findMany({
    select: { candidateNumber: true },
  });
  const existingNumbers = new Set(existingCandidates.map((c) => c.candidateNumber));
  console.log(`Existing candidates: ${existingNumbers.size}`);

  // 性別変換
  const genderMap: Record<string, string> = {
    "女": "female",
    "男": "male",
  };

  let insertedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const row of records) {
    const candidateNumber = row["求職者NO"]?.toString().trim();
    const name = row["求職者氏名_結合"]?.toString().trim();
    const nameKana = row["求職者カナ_結合"]?.toString().trim() || null;
    const genderRaw = row["性別"]?.toString().trim();
    const caEmployeeNo = row["CA_社員NO"]?.toString().trim();

    if (!candidateNumber || !name) {
      console.log(`Skipping invalid row: ${JSON.stringify(row)}`);
      errorCount++;
      continue;
    }

    // 重複チェック
    if (existingNumbers.has(candidateNumber)) {
      skippedCount++;
      continue;
    }

    const gender = genderMap[genderRaw] || null;
    const employeeId = caEmployeeNo ? employeeMap.get(caEmployeeNo) || null : null;

    try {
      await prisma.candidate.create({
        data: {
          candidateNumber,
          name,
          nameKana,
          gender,
          employeeId,
        },
      });
      insertedCount++;
      existingNumbers.add(candidateNumber); // 重複防止
    } catch (error) {
      console.error(`Error inserting ${candidateNumber}: ${error}`);
      errorCount++;
    }
  }

  console.log(`\n=== Import Complete ===`);
  console.log(`Inserted: ${insertedCount}`);
  console.log(`Skipped (already exists): ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
