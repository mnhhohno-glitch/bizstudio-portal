import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const EMPLOYEES = [
  { email: "masayuki_oono@bizstudio.co.jp", employeeNumber: 1000001 },
  { email: "nozomi_oono@bizstudio.co.jp", employeeNumber: 1000004 },
  { email: "kanako_okada@bizstudio.co.jp", employeeNumber: 1000007 },
  { email: "yoshitomi_ando@bizstudio.co.jp", employeeNumber: 1000008 },
  { email: "yuzo_nanjo@bizstudio.co.jp", employeeNumber: 1000009 },
  { email: "aoi_sato@bizstudio.co.jp", employeeNumber: 1000025 },
];

async function main() {
  let updated = 0;
  let skipped = 0;

  for (const { email, employeeNumber } of EMPLOYEES) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.log(`  スキップ: ${email}（ユーザーが見つかりません）`);
      skipped++;
      continue;
    }

    if (user.employeeNumber === employeeNumber) {
      console.log(`  スキップ: ${email}（既に設定済み: ${employeeNumber}）`);
      skipped++;
      continue;
    }

    await prisma.user.update({
      where: { email },
      data: { employeeNumber },
    });
    console.log(`  更新: ${user.name}（${email}）→ BS${employeeNumber}`);
    updated++;
  }

  console.log(`\n完了: 更新 ${updated}件 / スキップ ${skipped}件`);
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
