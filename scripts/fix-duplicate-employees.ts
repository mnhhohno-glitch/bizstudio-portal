import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("重複従業員の修正を開始します...");

  // 1. Find all employees
  const allEmployees = await prisma.employee.findMany({
    orderBy: { createdAt: "asc" },
  });
  console.log(`従業員数: ${allEmployees.length}`);

  // 2. Group by name to find duplicates
  const grouped = new Map<string, typeof allEmployees>();
  for (const emp of allEmployees) {
    const existing = grouped.get(emp.name) || [];
    existing.push(emp);
    grouped.set(emp.name, existing);
  }

  const duplicateGroups = [...grouped.entries()].filter(([, emps]) => emps.length > 1);

  if (duplicateGroups.length === 0) {
    console.log("重複する従業員は見つかりませんでした。");
    return;
  }

  console.log(`重複グループ数: ${duplicateGroups.length}`);

  for (const [name, employees] of duplicateGroups) {
    console.log(`\n--- 重複グループ: "${name}" (${employees.length}件) ---`);

    // Keep the first one (oldest by createdAt)
    const keeper = employees[0];
    const duplicates = employees.slice(1);

    console.log(`  保持: id=${keeper.id}, employeeNumber=${keeper.employeeNumber}`);

    for (const dup of duplicates) {
      console.log(`  重複: id=${dup.id}, employeeNumber=${dup.employeeNumber}`);

      // 3a. Migrate TaskAssignee references
      const taskAssignees = await prisma.taskAssignee.findMany({
        where: { employeeId: dup.id },
      });
      console.log(`    TaskAssignee参照数: ${taskAssignees.length}`);

      for (const ta of taskAssignees) {
        // Check if keeper already has this task assignment
        const existing = await prisma.taskAssignee.findUnique({
          where: {
            taskId_employeeId: {
              taskId: ta.taskId,
              employeeId: keeper.id,
            },
          },
        });

        if (existing) {
          // Already assigned to keeper, just delete the duplicate
          await prisma.taskAssignee.delete({ where: { id: ta.id } });
          console.log(`    TaskAssignee ${ta.id} を削除（既にkeeperに割当済み）`);
        } else {
          // Migrate to keeper
          await prisma.taskAssignee.update({
            where: { id: ta.id },
            data: { employeeId: keeper.id },
          });
          console.log(`    TaskAssignee ${ta.id} をkeeperに移行`);
        }
      }

      // 3b. Migrate Candidate references
      const candidates = await prisma.candidate.findMany({
        where: { employeeId: dup.id },
      });
      console.log(`    Candidate参照数: ${candidates.length}`);

      for (const cand of candidates) {
        await prisma.candidate.update({
          where: { id: cand.id },
          data: { employeeId: keeper.id },
        });
        console.log(`    Candidate ${cand.id} (${cand.name}) をkeeperに移行`);
      }

      // 4. Delete the duplicate employee
      await prisma.employee.delete({ where: { id: dup.id } });
      console.log(`    重複従業員 ${dup.id} を削除しました`);
    }
  }

  console.log("\n重複従業員の修正が完了しました。");
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
