import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // 監査ログ用 anonymous ユーザー
  await prisma.user.upsert({
    where: { email: "anonymous@local" },
    update: {},
    create: {
      name: "Anonymous",
      email: "anonymous@local",
      passwordHash: bcrypt.hashSync("not-used", 10),
      role: "member",
      status: "active",
    },
  });

  // 初期admin（あなた用） - パスワードは後で変更できる
  await prisma.user.upsert({
    where: { email: "admin@local" },
    update: {},
    create: {
      name: "Admin",
      email: "admin@local",
      passwordHash: bcrypt.hashSync("Admin1234!", 10),
      role: "admin",
      status: "active",
    },
  });

  // 社員マスターデータ
  const employees = [
    { employeeNumber: "1000001", name: "大野 将幸" },
    { employeeNumber: "1000007", name: "岡田 愛子" },
    { employeeNumber: "1000008", name: "安藤 嘉富" },
    { employeeNumber: "1000009", name: "南條 雄三" },
  ];

  for (const emp of employees) {
    await prisma.employee.upsert({
      where: { employeeNumber: emp.employeeNumber },
      update: { name: emp.name },
      create: {
        employeeNumber: emp.employeeNumber,
        name: emp.name,
        status: "active",
      },
    });
  }

  // システムリンク（連携アプリ）
  const systemLinks = [
    {
      name: "求人PDF解析ツール",
      description: "求人票PDFから情報を抽出し、求職者向け資料を生成",
      url: "https://kyuujin-pdf-tool-production.up.railway.app",
      sortOrder: 1,
    },
    {
      name: "候補者情報取り込み",
      description: "求職者の履歴書・職務経歴書から質問文を生成",
      url: "https://candidate-intake-production.up.railway.app",
      sortOrder: 2,
    },
    {
      name: "面接対策資料作成",
      description: "求職者向けの支援計画書・面接対策資料を生成",
      url: "https://manus-input-packager-prod-production.up.railway.app",
      sortOrder: 3,
    },
  ];

  for (const sys of systemLinks) {
    // URLで既存チェック（重複登録を防ぐ）
    const existing = await prisma.systemLink.findFirst({
      where: { url: sys.url },
    });
    if (!existing) {
      await prisma.systemLink.create({
        data: {
          name: sys.name,
          description: sys.description,
          url: sys.url,
          sortOrder: sys.sortOrder,
          status: "active",
        },
      });
      console.log(`Created system link: ${sys.name}`);
    } else {
      console.log(`System link already exists: ${sys.name}`);
    }
  }

  console.log("Seed completed: users, employees, and system links created");
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
