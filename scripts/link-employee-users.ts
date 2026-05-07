import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const isExecute = process.argv.includes("--execute");

type ActionRow = {
  employeeName: string;
  employeeId: string | null;
  userId: string | null;
  state: "既リンク" | "未リンク (1:1 同名)" | "未リンク (N:1 同名 User 複数)" | "未リンク (1:N 同名 Employee 複数)" | "未リンク (Employee なし)" | "未リンク (User なし)";
  action: "スキップ" | "リンク予定" | "リンク実行" | "スキップ・要手動";
};

async function main() {
  const mode = isExecute ? "EXECUTE" : "DRY RUN";
  console.log("========================================");
  console.log(`User-Employee 一括リンク (${mode})`);
  console.log("========================================\n");

  const users = await prisma.user.findMany({
    where: { status: "active" },
    select: { id: true, name: true, email: true },
  });
  const employees = await prisma.employee.findMany({
    where: { status: "active" },
    select: { id: true, employeeNumber: true, name: true, userId: true },
  });

  const totalUsers = users.length;
  const totalEmployees = employees.length;
  const linkedCount = employees.filter((e) => e.userId !== null).length;
  const unlinkedEmployees = employees.filter((e) => e.userId === null);
  const linkedUserIds = new Set(employees.map((e) => e.userId).filter((id): id is string => id !== null));
  const unlinkedUsers = users.filter((u) => !linkedUserIds.has(u.id));

  console.log("【現状サマリ】");
  console.log(`  Active User 総数:     ${totalUsers}`);
  console.log(`  Active Employee 総数: ${totalEmployees}`);
  console.log(`  リンク済み:           ${linkedCount}`);
  console.log(`  未リンク Employee:    ${unlinkedEmployees.length}`);
  console.log(`  未リンク User:        ${unlinkedUsers.length}\n`);

  // 同名グルーピング: User.name でグループ化
  const usersByName = new Map<string, typeof users>();
  for (const u of users) {
    const arr = usersByName.get(u.name) ?? [];
    arr.push(u);
    usersByName.set(u.name, arr);
  }
  const employeesByName = new Map<string, typeof employees>();
  for (const e of employees) {
    const arr = employeesByName.get(e.name) ?? [];
    arr.push(e);
    employeesByName.set(e.name, arr);
  }

  const rows: ActionRow[] = [];
  const linkPlan: { employeeId: string; userId: string; name: string }[] = [];

  // Employee 視点で走査
  for (const emp of employees) {
    if (emp.userId !== null) {
      rows.push({
        employeeName: emp.name,
        employeeId: emp.id,
        userId: emp.userId,
        state: "既リンク",
        action: "スキップ",
      });
      continue;
    }

    const sameNameUsers = usersByName.get(emp.name) ?? [];
    const sameNameEmployees = employeesByName.get(emp.name) ?? [];

    if (sameNameUsers.length === 0) {
      rows.push({
        employeeName: emp.name,
        employeeId: emp.id,
        userId: null,
        state: "未リンク (User なし)",
        action: "スキップ",
      });
      continue;
    }

    if (sameNameUsers.length > 1) {
      rows.push({
        employeeName: emp.name,
        employeeId: emp.id,
        userId: null,
        state: "未リンク (N:1 同名 User 複数)",
        action: "スキップ・要手動",
      });
      continue;
    }

    if (sameNameEmployees.length > 1) {
      rows.push({
        employeeName: emp.name,
        employeeId: emp.id,
        userId: null,
        state: "未リンク (1:N 同名 Employee 複数)",
        action: "スキップ・要手動",
      });
      continue;
    }

    // 1:1 同名 → リンク対象
    const targetUser = sameNameUsers[0];
    // userId 一意制約チェック (既に他 Employee で使われていないか)
    if (linkedUserIds.has(targetUser.id)) {
      rows.push({
        employeeName: emp.name,
        employeeId: emp.id,
        userId: null,
        state: "未リンク (N:1 同名 User 複数)",
        action: "スキップ・要手動",
      });
      continue;
    }

    rows.push({
      employeeName: emp.name,
      employeeId: emp.id,
      userId: targetUser.id,
      state: "未リンク (1:1 同名)",
      action: isExecute ? "リンク実行" : "リンク予定",
    });
    linkPlan.push({ employeeId: emp.id, userId: targetUser.id, name: emp.name });
  }

  // User 視点で Employee なしの未リンクを追加
  for (const u of unlinkedUsers) {
    const sameNameEmployees = employeesByName.get(u.name) ?? [];
    if (sameNameEmployees.length === 0) {
      rows.push({
        employeeName: `(User: ${u.name})`,
        employeeId: null,
        userId: u.id,
        state: "未リンク (Employee なし)",
        action: "スキップ",
      });
    }
  }

  console.log("【マッチング結果】");
  console.log("| Employee 氏名 | Employee.id | User.id | リンク状態 | アクション |");
  console.log("|---|---|---|---|---|");
  for (const r of rows) {
    console.log(
      `| ${r.employeeName} | ${r.employeeId ?? "-"} | ${r.userId ?? "-"} | ${r.state} | ${r.action} |`,
    );
  }
  console.log();

  const planCount = linkPlan.length;
  const manualCount = rows.filter((r) => r.action === "スキップ・要手動").length;
  const skipCount = rows.filter((r) => r.action === "スキップ").length;

  console.log("【集計】");
  console.log(`  リンク${isExecute ? "実行" : "予定"}: ${planCount} 件`);
  console.log(`  要手動:                ${manualCount} 件`);
  console.log(`  スキップ (既リンク等): ${skipCount} 件\n`);

  if (!isExecute) {
    console.log("DRY RUN モードなので DB 更新は行いません。");
    console.log("実行するには --execute フラグを付けてください。");
    return;
  }

  if (planCount === 0) {
    console.log("リンク対象がないため処理を終了します。");
    return;
  }

  console.log(`${planCount} 件のリンクを実行中...`);
  await prisma.$transaction(
    linkPlan.map((p) =>
      prisma.employee.update({
        where: { id: p.employeeId },
        data: { userId: p.userId },
      }),
    ),
  );
  console.log("✓ 一括 UPDATE 完了\n");

  // AuditLog 記録
  try {
    const anon = await prisma.user.findUnique({ where: { email: "anonymous@local" } });
    const actorId = anon?.id;
    if (actorId) {
      await prisma.auditLog.create({
        data: {
          actorUserId: actorId,
          action: "BULK_LINK_EMPLOYEE_USERS",
          targetType: "EMPLOYEE",
          targetId: null,
          metadata: {
            linkedCount: planCount,
            links: linkPlan.map((p) => ({ employeeId: p.employeeId, userId: p.userId, name: p.name })),
          },
        },
      });
      console.log("✓ AuditLog 記録完了");
    } else {
      console.log("⚠ anonymous@local ユーザーがないため AuditLog をスキップしました");
    }
  } catch (e) {
    console.error("⚠ AuditLog 記録に失敗:", e);
  }

  // 結果再検証
  const after = await prisma.employee.count({
    where: { status: "active", userId: { not: null } },
  });
  console.log(`\n修正後のリンク済み Employee 数: ${after} / ${totalEmployees}`);
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
