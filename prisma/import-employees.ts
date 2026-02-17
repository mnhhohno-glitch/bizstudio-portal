import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// 社員データ
const employees = [
  { role: "管理者", employeeNumber: "BS1000001", name: "大野 将幸", status: "在籍", email: "masayuki_oono@bizstudio.co.jp" },
  { role: "一般", employeeNumber: "BS1000002", name: "小野 有加", status: "退職", email: "yuka_ono@bizstudio.co.jp" },
  { role: "一般", employeeNumber: "BS1000003", name: "藤本 夏海", status: "産休", email: "natsumi_fujimoto@bizstudio.co.jp" },
  { role: "一般", employeeNumber: "BS1000004", name: "大野 望", status: "在籍", email: "nozomi_oono@bizstudio.co.jp" },
  { role: "一般", employeeNumber: "BS1000005", name: "上原 千遥", status: "産休", email: "chiharu_uehara@bizstudio.co.jp" },
  { role: "一般", employeeNumber: "BS1000006", name: "村上 輝", status: "退職", email: "akira_murakami@bizstudio.co.jp" },
  { role: "一般", employeeNumber: "BS1000007", name: "岡田 愛子", status: "在籍", email: "kanako_okada@bizstudio.co.jp" },
  { role: "一般", employeeNumber: "BS1000008", name: "安藤 嘉富", status: "在籍", email: "yoshitomi_ando@bizstudio.co.jp" },
  { role: "一般", employeeNumber: "BS1000009", name: "南條 雄三", status: "委託", email: "yuzo_nanjo@bizstudio.co.jp" },
  { role: "一般", employeeNumber: "BS1000025", name: "佐藤 葵", status: "在籍", email: "aoi_sato@bizstudio.co.jp" },
];

async function main() {
  console.log(`Importing ${employees.length} employees...`);

  let upsertedCount = 0;

  for (const emp of employees) {
    // 在籍状況 → status変換（退職のみdisabled、それ以外はactive）
    const status = emp.status === "退職" ? "disabled" : "active";

    await prisma.employee.upsert({
      where: { employeeNumber: emp.employeeNumber },
      update: {
        name: emp.name,
        status,
      },
      create: {
        employeeNumber: emp.employeeNumber,
        name: emp.name,
        status,
      },
    });
    console.log(`Upserted: ${emp.employeeNumber} - ${emp.name} (${status})`);
    upsertedCount++;
  }

  console.log(`\n=== Import Complete ===`);
  console.log(`Total upserted: ${upsertedCount}`);

  // 確認
  const allEmployees = await prisma.employee.findMany({ orderBy: { employeeNumber: "asc" } });
  console.log(`\nCurrent employees in DB: ${allEmployees.length}`);
  for (const e of allEmployees) {
    console.log(`  ${e.employeeNumber}: ${e.name} (${e.status})`);
  }
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
