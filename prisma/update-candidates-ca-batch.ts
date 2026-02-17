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
  // CSVファイルを読み込み
  console.log("Loading CSV...");
  const csvPath = "./prisma/inport_kyuusyokusya.csv";
  const buffer = fs.readFileSync(csvPath);
  const content = iconv.decode(buffer, "Shift_JIS");
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  console.log(`CSV records: ${records.length}`);

  // 社員マスタを取得
  const employees = await prisma.employee.findMany();
  const employeeMap = new Map<string, string>();
  for (const emp of employees) {
    employeeMap.set(emp.employeeNumber, emp.id);
  }
  console.log(`Employees: ${employees.length}`);

  // 求職者番号 → 社員番号のマップを作成
  const candidateToCA = new Map<string, string>();
  for (const row of records) {
    const candidateNumber = row["求職者NO"]?.toString().trim();
    const caEmployeeNo = row["CA_社員NO"]?.toString().trim();
    if (candidateNumber && caEmployeeNo) {
      candidateToCA.set(candidateNumber, caEmployeeNo);
    }
  }
  console.log(`Candidate-CA mappings: ${candidateToCA.size}`);

  // 社員番号ごとにグループ化して一括更新
  const caGroups = new Map<string, string[]>();
  for (const [candidateNo, caNo] of candidateToCA) {
    if (!caGroups.has(caNo)) {
      caGroups.set(caNo, []);
    }
    caGroups.get(caNo)!.push(candidateNo);
  }
  console.log(`CA groups: ${caGroups.size}`);

  let totalUpdated = 0;
  let caNotFound = 0;

  for (const [caNo, candidateNumbers] of caGroups) {
    const employeeId = employeeMap.get(caNo);
    if (!employeeId) {
      console.log(`CA not found: ${caNo} (${candidateNumbers.length} candidates)`);
      caNotFound += candidateNumbers.length;
      continue;
    }

    // バッチで更新
    const result = await prisma.candidate.updateMany({
      where: { candidateNumber: { in: candidateNumbers } },
      data: { employeeId },
    });
    totalUpdated += result.count;
    console.log(`Updated ${result.count} candidates for CA: ${caNo}`);
  }

  console.log(`\n=== Complete ===`);
  console.log(`Total updated: ${totalUpdated}`);
  console.log(`CA not found: ${caNotFound}`);

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
