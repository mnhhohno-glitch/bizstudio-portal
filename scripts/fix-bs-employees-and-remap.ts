import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("=== BS社員の統合・削除スクリプト ===\n");

  // 1. BSプレフィックス付き Employee を取得
  const allEmployees = await prisma.employee.findMany({
    select: { id: true, employeeNumber: true, name: true },
    orderBy: { employeeNumber: "asc" },
  });

  console.log("全Employee:");
  for (const e of allEmployees) {
    console.log(`  ${e.employeeNumber} | ${e.name} | ${e.id}`);
  }

  const bsEmployees = allEmployees.filter((e) => e.employeeNumber.startsWith("BS"));
  console.log(`\nBSプレフィックス付き社員: ${bsEmployees.length}件\n`);

  if (bsEmployees.length === 0) {
    console.log("BSプレフィックス付き社員はいません。終了。");
    return;
  }

  for (const bsEmp of bsEmployees) {
    const normalizedNo = bsEmp.employeeNumber.replace(/^BS/i, "");
    const correctEmp = allEmployees.find((e) => e.employeeNumber === normalizedNo);

    if (!correctEmp) {
      console.log(`⚠ 正規社員が見つからない: ${bsEmp.employeeNumber} → ${normalizedNo}（スキップ）`);
      continue;
    }

    console.log(`--- 統合: ${bsEmp.employeeNumber}(${bsEmp.name}) → ${correctEmp.employeeNumber}(${correctEmp.name}) ---`);

    // 重複チェック: 正規社員に既に同じ日付のDailyAttendanceがあるか
    const correctDates = await prisma.dailyAttendance.findMany({
      where: { employeeId: correctEmp.id },
      select: { date: true },
    });
    const correctDateSet = new Set(correctDates.map((d) => d.date.toISOString()));

    // BS側のDailyAttendanceを取得
    const bsAttendances = await prisma.dailyAttendance.findMany({
      where: { employeeId: bsEmp.id },
      select: { id: true, date: true },
    });

    const duplicateDates = bsAttendances.filter((a) => correctDateSet.has(a.date.toISOString()));
    const uniqueDates = bsAttendances.filter((a) => !correctDateSet.has(a.date.toISOString()));

    console.log(`  DailyAttendance: ${bsAttendances.length}件 (重複: ${duplicateDates.length}, 移行対象: ${uniqueDates.length})`);

    // 重複する日付のBS側データを削除（PunchEventも先に削除）
    if (duplicateDates.length > 0) {
      const dupIds = duplicateDates.map((d) => d.id);
      const deletedPunches = await prisma.punchEvent.deleteMany({
        where: { dailyAttendanceId: { in: dupIds } },
      });
      console.log(`  重複PunchEvent削除: ${deletedPunches.count}件`);

      const deletedAtt = await prisma.dailyAttendance.deleteMany({
        where: { id: { in: dupIds } },
      });
      console.log(`  重複DailyAttendance削除: ${deletedAtt.count}件`);
    }

    // 残りのDailyAttendanceを正規社員に付け替え
    if (uniqueDates.length > 0) {
      const movedAtt = await prisma.dailyAttendance.updateMany({
        where: { employeeId: bsEmp.id },
        data: { employeeId: correctEmp.id },
      });
      console.log(`  DailyAttendance移行: ${movedAtt.count}件`);

      const movedPunch = await prisma.punchEvent.updateMany({
        where: { employeeId: bsEmp.id },
        data: { employeeId: correctEmp.id },
      });
      console.log(`  PunchEvent移行: ${movedPunch.count}件`);
    }

    // ModificationRequest / LeaveRequest 付け替え
    const movedMod = await prisma.modificationRequest.updateMany({
      where: { employeeId: bsEmp.id },
      data: { employeeId: correctEmp.id },
    });
    if (movedMod.count > 0) console.log(`  ModificationRequest移行: ${movedMod.count}件`);

    const movedLeave = await prisma.leaveRequest.updateMany({
      where: { employeeId: bsEmp.id },
      data: { employeeId: correctEmp.id },
    });
    if (movedLeave.count > 0) console.log(`  LeaveRequest移行: ${movedLeave.count}件`);

    // TaskAssignee / Candidate 付け替え
    const movedTask = await prisma.taskAssignee.updateMany({
      where: { employeeId: bsEmp.id },
      data: { employeeId: correctEmp.id },
    });
    if (movedTask.count > 0) console.log(`  TaskAssignee移行: ${movedTask.count}件`);

    const movedCand = await prisma.candidate.updateMany({
      where: { employeeId: bsEmp.id },
      data: { employeeId: correctEmp.id },
    });
    if (movedCand.count > 0) console.log(`  Candidate移行: ${movedCand.count}件`);

    // BS Employee 削除
    await prisma.employee.delete({ where: { id: bsEmp.id } });
    console.log(`  ✓ ${bsEmp.employeeNumber} を削除完了`);
  }

  // 結果確認
  console.log("\n=== 統合後のEmployee ===");
  const remaining = await prisma.employee.findMany({
    select: { employeeNumber: true, name: true },
    orderBy: { employeeNumber: "asc" },
  });
  for (const e of remaining) {
    console.log(`  ${e.employeeNumber} | ${e.name}`);
  }

  const attCount = await prisma.dailyAttendance.count();
  console.log(`\nDailyAttendance総数: ${attCount}`);
}

main()
  .catch((e) => { console.error("エラー:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
