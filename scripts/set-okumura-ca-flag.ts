import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TARGET_EMAIL = "yuji_okumura@bizstudio.co.jp";
const TARGET_NAME = "奥村 裕司";
const TARGET_JOB_CATEGORY = "CA" as const;

const isExecute = process.argv.includes("--execute");
const allowCreateEmployee = process.argv.includes("--create-employee");

async function main() {
  const mode = isExecute ? "EXECUTE" : "DRY RUN";
  console.log("========================================");
  console.log(`奥村裕司 を CA に設定 (${mode}${allowCreateEmployee ? " / Employee 自動作成許可" : ""})`);
  console.log("========================================\n");

  // Step 1: User の特定（メール優先 → 氏名フォールバック）
  let users = await prisma.user.findMany({
    where: { email: TARGET_EMAIL },
    select: { id: true, name: true, email: true, employeeNumber: true },
  });
  if (users.length === 0) {
    console.log(`メール ${TARGET_EMAIL} で見つからないため氏名検索にフォールバック`);
    users = await prisma.user.findMany({
      where: { name: TARGET_NAME },
      select: { id: true, name: true, email: true, employeeNumber: true },
    });
  }
  if (users.length === 0) {
    console.error(`✗ User が見つかりません (email=${TARGET_EMAIL} / name=${TARGET_NAME})`);
    process.exit(1);
  }
  if (users.length > 1) {
    console.error(`✗ User が複数ヒットしました (${users.length}件)。安全のため停止します。`);
    users.forEach((u) => console.error(`  - ${u.id} / ${u.name} / ${u.email}`));
    process.exit(1);
  }
  const user = users[0];
  console.log(`✓ User 特定:`);
  console.log(`  id: ${user.id}`);
  console.log(`  name: ${user.name}`);
  console.log(`  email: ${user.email}`);
  console.log(`  employeeNumber: ${user.employeeNumber ?? "null"}\n`);

  // Step 2: Employee の特定（userId 経由）
  const employee = await prisma.employee.findUnique({
    where: { userId: user.id },
    select: { id: true, employeeNumber: true, name: true, jobCategory: true },
  });

  if (employee) {
    console.log(`✓ Employee 特定:`);
    console.log(`  id: ${employee.id}`);
    console.log(`  employeeNumber: ${employee.employeeNumber}`);
    console.log(`  name: ${employee.name}`);
    console.log(`  現在 jobCategory: ${employee.jobCategory ?? "null"}\n`);

    if (employee.jobCategory === TARGET_JOB_CATEGORY) {
      console.log(`✓ 既に jobCategory=${TARGET_JOB_CATEGORY} のため更新不要。`);
      return;
    }

    console.log(`以下の UPDATE を実行します:`);
    console.log(`  UPDATE employees SET job_category = '${TARGET_JOB_CATEGORY}' WHERE id = '${employee.id}'\n`);

    if (!isExecute) {
      console.log("DRY RUN モードなので実行しません。");
      console.log("実行するには --execute フラグを付けてください。");
      return;
    }

    const updated = await prisma.employee.update({
      where: { id: employee.id },
      data: { jobCategory: TARGET_JOB_CATEGORY },
      select: { id: true, employeeNumber: true, name: true, jobCategory: true },
    });
    console.log("✓ 更新完了\n");
    console.log("更新後のレコード:");
    console.log(`  id: ${updated.id}`);
    console.log(`  employeeNumber: ${updated.employeeNumber}`);
    console.log(`  name: ${updated.name}`);
    console.log(`  jobCategory: ${updated.jobCategory}`);
    return;
  }

  // Step 3: Employee 未作成 → 作成許可フラグの確認
  console.log(`⚠ Employee レコードが userId=${user.id} 経由で見つかりません。`);
  if (user.employeeNumber == null) {
    console.error("✗ User.employeeNumber も null のため、Employee 作成のための社員番号が確定できません。");
    console.error("  /admin/users 画面で社員番号を入力するか、別途確認してください。");
    process.exit(1);
  }
  const targetEmployeeNumber = String(user.employeeNumber);

  // 社員番号重複チェック
  const numberConflict = await prisma.employee.findUnique({
    where: { employeeNumber: targetEmployeeNumber },
    select: { id: true, name: true, userId: true, jobCategory: true },
  });
  if (numberConflict) {
    if (numberConflict.userId === null) {
      console.log(`同じ社員番号 ${targetEmployeeNumber} の Employee が userId 未設定で存在します:`);
      console.log(`  id: ${numberConflict.id}, name: ${numberConflict.name}`);
      console.log(`  既存 Employee に userId=${user.id} と jobCategory=${TARGET_JOB_CATEGORY} をセットします。\n`);
      if (!isExecute) {
        console.log("DRY RUN モードなので実行しません。");
        console.log("実行するには --execute フラグを付けてください。");
        return;
      }
      const updated = await prisma.employee.update({
        where: { id: numberConflict.id },
        data: { userId: user.id, jobCategory: TARGET_JOB_CATEGORY },
        select: { id: true, employeeNumber: true, name: true, jobCategory: true, userId: true },
      });
      console.log("✓ リンク + 更新完了:");
      console.log(JSON.stringify(updated, null, 2));
      return;
    }
    console.error(`✗ 社員番号 ${targetEmployeeNumber} が別の Employee に既にリンクされています:`);
    console.error(`  id: ${numberConflict.id}, name: ${numberConflict.name}, userId: ${numberConflict.userId}`);
    process.exit(1);
  }

  if (!allowCreateEmployee) {
    console.log("\nEmployee 新規作成のプレビュー:");
    console.log(`  employeeNumber: ${targetEmployeeNumber}`);
    console.log(`  name: ${user.name}`);
    console.log(`  userId: ${user.id}`);
    console.log(`  jobCategory: ${TARGET_JOB_CATEGORY}`);
    console.log("\n新規作成するには --create-employee --execute を付けて再実行してください。");
    return;
  }

  if (!isExecute) {
    console.log("\nEmployee 新規作成のプレビュー (DRY RUN):");
    console.log(`  employeeNumber: ${targetEmployeeNumber}`);
    console.log(`  name: ${user.name}`);
    console.log(`  userId: ${user.id}`);
    console.log(`  jobCategory: ${TARGET_JOB_CATEGORY}`);
    console.log("\n実行するには --create-employee --execute を付けて再実行してください。");
    return;
  }

  const created = await prisma.employee.create({
    data: {
      employeeNumber: targetEmployeeNumber,
      name: user.name,
      userId: user.id,
      jobCategory: TARGET_JOB_CATEGORY,
    },
    select: { id: true, employeeNumber: true, name: true, userId: true, jobCategory: true },
  });
  console.log("✓ Employee 新規作成完了:");
  console.log(JSON.stringify(created, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
