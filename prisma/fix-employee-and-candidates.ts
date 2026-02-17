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
  // 1. 旧社員データ（BSなし）を削除
  console.log("=== Step 1: Delete old employees (without BS prefix) ===");
  const oldEmployees = await prisma.employee.findMany({
    where: {
      NOT: { employeeNumber: { startsWith: "BS" } },
    },
  });
  console.log(`Found ${oldEmployees.length} old employees to delete`);

  for (const emp of oldEmployees) {
    // まず関連する求職者のemployeeIdをnullにする
    await prisma.candidate.updateMany({
      where: { employeeId: emp.id },
      data: { employeeId: null },
    });
    // 社員を削除
    await prisma.employee.delete({ where: { id: emp.id } });
    console.log(`Deleted: ${emp.employeeNumber} - ${emp.name}`);
  }

  // 2. 求職者の担当CAを再紐付け
  console.log("\n=== Step 2: Re-link candidates with employees ===");

  // CSVファイルを読み込み
  const csvPath = "./prisma/inport_kyuusyokusya.csv";
  const buffer = fs.readFileSync(csvPath);
  const content = iconv.decode(buffer, "Shift_JIS");
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  // 社員マスタを取得（社員番号 → ID のマップ）
  const employees = await prisma.employee.findMany();
  const employeeMap = new Map<string, string>();
  for (const emp of employees) {
    employeeMap.set(emp.employeeNumber, emp.id);
  }
  console.log(`Employees loaded: ${employees.length}`);

  let updatedCount = 0;
  let notFoundCount = 0;

  for (const row of records) {
    const candidateNumber = row["求職者NO"]?.toString().trim();
    const caEmployeeNo = row["CA_社員NO"]?.toString().trim();

    if (!candidateNumber || !caEmployeeNo) continue;

    const employeeId = employeeMap.get(caEmployeeNo);
    if (!employeeId) {
      notFoundCount++;
      continue;
    }

    const result = await prisma.candidate.updateMany({
      where: { candidateNumber },
      data: { employeeId },
    });

    if (result.count > 0) {
      updatedCount++;
    }
  }

  console.log(`Updated candidates: ${updatedCount}`);
  console.log(`CA not found: ${notFoundCount}`);

  // 確認
  console.log("\n=== Verification ===");
  const candidatesWithCA = await prisma.candidate.count({
    where: { employeeId: { not: null } },
  });
  const totalCandidates = await prisma.candidate.count();
  console.log(`Candidates with CA: ${candidatesWithCA} / ${totalCandidates}`);
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
