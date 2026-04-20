import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TARGET_USER_ID = "cml9jturt00037k4ftqsi6yvz";
const TARGET_EMPLOYEE_ID = "cmlqr5h1n0000tg4f6h6gbhcn";

const isExecute = process.argv.includes("--execute");
const isRollback = process.argv.includes("--rollback");

async function main() {
  const mode = isRollback ? "ROLLBACK" : isExecute ? "EXECUTE" : "DRY RUN";
  console.log("========================================");
  console.log(`Employee.userId 修正 (${mode})`);
  console.log("========================================\n");

  const user = await prisma.user.findUnique({
    where: { id: TARGET_USER_ID },
    select: { id: true, name: true, email: true },
  });
  if (!user) {
    console.error(`✗ User が見つかりません: ${TARGET_USER_ID}`);
    process.exit(1);
  }
  console.log(`✓ User 取得成功:`);
  console.log(`  id: ${user.id}`);
  console.log(`  name: ${user.name}`);
  console.log(`  email: ${user.email}\n`);

  const employee = await prisma.employee.findUnique({
    where: { id: TARGET_EMPLOYEE_ID },
    select: { id: true, employeeNumber: true, name: true, userId: true },
  });
  if (!employee) {
    console.error(`✗ Employee が見つかりません: ${TARGET_EMPLOYEE_ID}`);
    process.exit(1);
  }
  console.log(`✓ Employee 取得成功:`);
  console.log(`  id: ${employee.id}`);
  console.log(`  employeeNo: ${employee.employeeNumber}`);
  console.log(`  name: ${employee.name}`);
  console.log(`  userId: ${employee.userId ?? "null (紐付け無し)"}\n`);

  if (isRollback) {
    if (employee.userId === null) {
      console.log("既に userId は null です。ロールバック不要。");
      return;
    }
    console.log(`以下の UPDATE を実行します:`);
    console.log(`  UPDATE employees SET user_id = NULL WHERE id = '${TARGET_EMPLOYEE_ID}'\n`);

    if (!isExecute) {
      console.log("DRY RUN モードなので実行しません。");
      console.log("実行するには --rollback --execute を付けてください。");
      return;
    }

    const updated = await prisma.employee.update({
      where: { id: TARGET_EMPLOYEE_ID },
      data: { userId: null },
      select: { id: true, employeeNumber: true, name: true, userId: true },
    });
    console.log("✓ ロールバック完了\n");
    console.log("更新後のレコード:");
    console.log(`  id: ${updated.id}`);
    console.log(`  employeeNo: ${updated.employeeNumber}`);
    console.log(`  name: ${updated.name}`);
    console.log(`  userId: ${updated.userId ?? "null"}`);
    return;
  }

  // 通常モード: userId を設定
  if (employee.userId === TARGET_USER_ID) {
    console.log("✓ 既に正しい userId が設定されています。修正不要。");
    return;
  }
  if (employee.userId !== null) {
    console.error(`⚠ userId が既に別の値に設定されています: ${employee.userId}`);
    console.error("誤上書き防止のため中断します。");
    process.exit(1);
  }

  // userId の一意制約チェック
  const conflict = await prisma.employee.findFirst({
    where: { userId: TARGET_USER_ID },
    select: { id: true, name: true, employeeNumber: true },
  });
  if (conflict) {
    console.error(`✗ userId '${TARGET_USER_ID}' は既に別の Employee に紐付いています:`);
    console.error(`  id: ${conflict.id}, name: ${conflict.name}, employeeNo: ${conflict.employeeNumber}`);
    process.exit(1);
  }

  console.log(`以下の UPDATE を実行します:`);
  console.log(`  UPDATE employees SET user_id = '${TARGET_USER_ID}' WHERE id = '${TARGET_EMPLOYEE_ID}'\n`);

  if (!isExecute) {
    console.log("DRY RUN モードなので実行しません。");
    console.log("実行するには --execute フラグを付けてください。");
    return;
  }

  console.log("UPDATE 実行中...");
  const updated = await prisma.employee.update({
    where: { id: TARGET_EMPLOYEE_ID },
    data: { userId: TARGET_USER_ID },
    select: { id: true, employeeNumber: true, name: true, userId: true },
  });
  console.log("✓ 更新完了\n");
  console.log("更新後のレコード:");
  console.log(`  id: ${updated.id}`);
  console.log(`  employeeNo: ${updated.employeeNumber}`);
  console.log(`  name: ${updated.name}`);
  console.log(`  userId: ${updated.userId}\n`);
  console.log("動作確認方法:");
  console.log("1. 対象環境にログイン（シークレットモード推奨）");
  console.log("2. 求職者詳細ページを開く");
  console.log("3. 面談履歴タブで「+新規面談」ボタンをクリック");
  console.log("4. フォームが開けば成功");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
