import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// 社員データ
const employees = [
  { role: "admin", employeeNumber: "BS1000001", name: "大野 将幸", status: "在籍", email: "masayuki_oono@bizstudio.co.jp" },
  { role: "member", employeeNumber: "BS1000002", name: "小野 有加", status: "退職", email: "yuka_ono@bizstudio.co.jp" },
  { role: "member", employeeNumber: "BS1000003", name: "藤本 夏海", status: "産休", email: "natsumi_fujimoto@bizstudio.co.jp" },
  { role: "member", employeeNumber: "BS1000004", name: "大野 望", status: "在籍", email: "nozomi_oono@bizstudio.co.jp" },
  { role: "member", employeeNumber: "BS1000005", name: "上原 千遥", status: "産休", email: "chiharu_uehara@bizstudio.co.jp" },
  { role: "member", employeeNumber: "BS1000006", name: "村上 輝", status: "退職", email: "akira_murakami@bizstudio.co.jp" },
  { role: "member", employeeNumber: "BS1000007", name: "岡田 愛子", status: "在籍", email: "kanako_okada@bizstudio.co.jp" },
  { role: "member", employeeNumber: "BS1000008", name: "安藤 嘉富", status: "在籍", email: "yoshitomi_ando@bizstudio.co.jp" },
  { role: "member", employeeNumber: "BS1000009", name: "南條 雄三", status: "在籍", email: "yuzo_nanjo@bizstudio.co.jp" },
  { role: "member", employeeNumber: "BS1000025", name: "佐藤 葵", status: "在籍", email: "aoi_sato@bizstudio.co.jp" },
];

async function main() {
  // 1. Admin, Anonymousを削除
  console.log("=== Step 1: Delete Admin and Anonymous ===");
  
  // まず対象ユーザーのIDを取得
  const usersToDelete = await prisma.user.findMany({
    where: {
      email: { in: ["admin@local", "anonymous@local"] },
    },
  });
  
  for (const user of usersToDelete) {
    // 関連する監査ログを削除
    await prisma.auditLog.deleteMany({
      where: { actorUserId: user.id },
    });
    // 関連する招待を削除
    await prisma.invite.deleteMany({
      where: { createdByUserId: user.id },
    });
    // ユーザーを削除
    await prisma.user.delete({
      where: { id: user.id },
    });
    console.log(`Deleted: ${user.name} (${user.email})`);
  }
  console.log(`Total deleted: ${usersToDelete.length} users`);

  // 2. 社員をUserとして登録（upsert）
  console.log("\n=== Step 2: Register employees as Users ===");
  
  // 仮パスワード（後で各自変更してもらう）
  const tempPassword = "Bizstudio2024!";
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  for (const emp of employees) {
    // 在籍状況 → status変換（退職のみdisabled）
    const userStatus = emp.status === "退職" ? "disabled" : "active";
    const userRole = emp.role === "admin" ? "admin" : "member";

    await prisma.user.upsert({
      where: { email: emp.email },
      update: {
        name: emp.name,
        role: userRole,
        status: userStatus,
      },
      create: {
        name: emp.name,
        email: emp.email,
        passwordHash,
        role: userRole,
        status: userStatus,
      },
    });
    console.log(`Upserted: ${emp.name} (${emp.email}) - ${userRole}, ${userStatus}`);
  }

  // 確認
  console.log("\n=== Current Users ===");
  const users = await prisma.user.findMany({ orderBy: { email: "asc" } });
  for (const u of users) {
    console.log(`${u.name}: ${u.email} (${u.role}, ${u.status})`);
  }
  console.log(`Total: ${users.length}`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
