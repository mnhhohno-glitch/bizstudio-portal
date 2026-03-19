import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// BS付き → 元レコードへのマッピング（大野・岡田は前回で解消済み）
const DUPLICATES = [
  { bsEmpNo: "BS1000001", origEmpNo: "1000001", name: "大野 将幸" },
  { bsEmpNo: "BS1000007", origEmpNo: "1000007", name: "岡田 愛子" },
  { bsEmpNo: "BS1000008", origEmpNo: "1000008", name: "安藤 嘉富" },
  { bsEmpNo: "BS1000009", origEmpNo: "1000009", name: "南條 雄三" },
];

async function main() {
  console.log("=== 社員重複解消スクリプト v2 ===\n");

  for (const dup of DUPLICATES) {
    const bsEmp = await prisma.employee.findFirst({ where: { employeeNumber: dup.bsEmpNo } });
    const origEmp = await prisma.employee.findFirst({ where: { employeeNumber: dup.origEmpNo } });

    if (!bsEmp) {
      console.log(`[skip] ${dup.name} (${dup.bsEmpNo}) は既に解消済み`);
      continue;
    }
    if (!origEmp) {
      console.log(`[error] ${dup.name} (${dup.origEmpNo}) 元レコードが見つかりません！`);
      continue;
    }

    console.log(`\n--- ${dup.name} ---`);
    console.log(`  削除対象: ${bsEmp.id} (${dup.bsEmpNo})`);
    console.log(`  統合先:   ${origEmp.id} (${dup.origEmpNo})`);

    // リレーション件数を確認
    const taskAssigneeCount = await prisma.taskAssignee.count({ where: { employeeId: bsEmp.id } });
    const candidateCount = await prisma.candidate.count({ where: { employeeId: bsEmp.id } });
    const dailyAttendanceCount = await prisma.dailyAttendance.count({ where: { employeeId: bsEmp.id } });
    const punchEventCount = await prisma.punchEvent.count({ where: { employeeId: bsEmp.id } });
    const modReqCount = await prisma.modificationRequest.count({ where: { employeeId: bsEmp.id } });
    const leaveReqCount = await prisma.leaveRequest.count({ where: { employeeId: bsEmp.id } });

    console.log(`  移し替え: TaskAssignee ${taskAssigneeCount}, Candidate ${candidateCount}, DailyAttendance ${dailyAttendanceCount}, PunchEvent ${punchEventCount}, ModReq ${modReqCount}, LeaveReq ${leaveReqCount}`);

    await prisma.$transaction(async (tx) => {
      // TaskAssignee の移し替え
      if (taskAssigneeCount > 0) {
        const bsAssignees = await tx.taskAssignee.findMany({ where: { employeeId: bsEmp.id } });
        for (const a of bsAssignees) {
          const existing = await tx.taskAssignee.findFirst({
            where: { taskId: a.taskId, employeeId: origEmp.id },
          });
          if (existing) {
            await tx.taskAssignee.delete({ where: { id: a.id } });
            console.log(`    [delete] TaskAssignee ${a.id} (重複)`);
          } else {
            await tx.taskAssignee.update({ where: { id: a.id }, data: { employeeId: origEmp.id } });
            console.log(`    [move] TaskAssignee → ${origEmp.id}`);
          }
        }
      }

      // Candidate の担当CA移し替え
      if (candidateCount > 0) {
        await tx.candidate.updateMany({ where: { employeeId: bsEmp.id }, data: { employeeId: origEmp.id } });
        console.log(`    [move] Candidate ${candidateCount}件`);
      }

      // PunchEvent の移し替え（DailyAttendanceより先に）
      if (punchEventCount > 0) {
        await tx.punchEvent.updateMany({ where: { employeeId: bsEmp.id }, data: { employeeId: origEmp.id } });
        console.log(`    [move] PunchEvent ${punchEventCount}件`);
      }

      // DailyAttendance の移し替え（同一日の重複チェック）
      if (dailyAttendanceCount > 0) {
        const bsAttendances = await tx.dailyAttendance.findMany({ where: { employeeId: bsEmp.id } });
        for (const da of bsAttendances) {
          const existing = await tx.dailyAttendance.findFirst({
            where: { employeeId: origEmp.id, date: da.date },
          });
          if (existing) {
            // 同日のデータが元レコードに既にある場合、BS側を削除
            // PunchEventは既に移し替え済みなのでdailyAttendanceIdを更新
            await tx.punchEvent.updateMany({
              where: { dailyAttendanceId: da.id },
              data: { dailyAttendanceId: existing.id },
            });
            await tx.dailyAttendance.delete({ where: { id: da.id } });
            console.log(`    [merge] DailyAttendance ${da.id} → ${existing.id} (同日統合)`);
          } else {
            await tx.dailyAttendance.update({ where: { id: da.id }, data: { employeeId: origEmp.id } });
            console.log(`    [move] DailyAttendance ${da.id}`);
          }
        }
      }

      // ModificationRequest の移し替え
      if (modReqCount > 0) {
        await tx.modificationRequest.updateMany({ where: { employeeId: bsEmp.id }, data: { employeeId: origEmp.id } });
        console.log(`    [move] ModificationRequest ${modReqCount}件`);
      }

      // LeaveRequest の移し替え
      if (leaveReqCount > 0) {
        await tx.leaveRequest.updateMany({ where: { employeeId: bsEmp.id }, data: { employeeId: origEmp.id } });
        console.log(`    [move] LeaveRequest ${leaveReqCount}件`);
      }

      // BS Employeeレコードを削除
      await tx.employee.delete({ where: { id: bsEmp.id } });
      console.log(`    [delete] Employee ${bsEmp.id} (${dup.bsEmpNo})`);
    });

    console.log(`  ✓ ${dup.name} の統合完了`);
  }

  console.log("\n=== 完了 ===");

  // 最終確認
  const remaining = await prisma.employee.findMany({
    where: { status: "active" },
    orderBy: { employeeNumber: "asc" },
    select: { id: true, name: true, employeeNumber: true },
  });
  console.log("\n=== 残りのアクティブ社員 ===");
  remaining.forEach((e) => console.log(`  ${e.employeeNumber} | ${e.name}`));
}

main()
  .catch((e) => {
    console.error("エラー:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
