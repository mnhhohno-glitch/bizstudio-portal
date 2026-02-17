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
  // BS1000003（藤本夏海）のIDを取得
  const fujimoto = await prisma.employee.findUnique({
    where: { employeeNumber: "BS1000003" },
  });

  if (!fujimoto) {
    console.error("BS1000003 not found!");
    return;
  }

  console.log(`Target CA: ${fujimoto.employeeNumber} - ${fujimoto.name} (ID: ${fujimoto.id})`);

  // CSVから置換対象の求職者番号を取得
  const csvPath = "./prisma/inport_kyuusyokusya.csv";
  const buffer = fs.readFileSync(csvPath);
  const content = iconv.decode(buffer, "Shift_JIS");
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  // BS1000010〜BS1000015の求職者番号を収集
  const targetCANumbers = ["BS1000010", "BS1000011", "BS1000012", "BS1000013", "BS1000014", "BS1000015"];
  const candidateNumbers: string[] = [];

  for (const row of records) {
    const candidateNumber = row["求職者NO"]?.toString().trim();
    const caEmployeeNo = row["CA_社員NO"]?.toString().trim();
    if (candidateNumber && targetCANumbers.includes(caEmployeeNo)) {
      candidateNumbers.push(candidateNumber);
    }
  }

  console.log(`Candidates to update: ${candidateNumbers.length}`);

  // 一括更新
  const result = await prisma.candidate.updateMany({
    where: { candidateNumber: { in: candidateNumbers } },
    data: { employeeId: fujimoto.id },
  });

  console.log(`Updated: ${result.count}`);

  // 確認
  const withCA = await prisma.candidate.count({ where: { employeeId: { not: null } } });
  const total = await prisma.candidate.count();
  console.log(`Candidates with CA: ${withCA} / ${total}`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
