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

  console.log("Seed completed: anonymous@local, admin@local created");
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
