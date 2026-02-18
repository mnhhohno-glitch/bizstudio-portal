import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// 社員データ（メール → 社員番号）
const employeePasswords: Record<string, string> = {
  "masayuki_oono@bizstudio.co.jp": "BS1000001xx",
  "yuka_ono@bizstudio.co.jp": "BS1000002xx",
  "natsumi_fujimoto@bizstudio.co.jp": "BS1000003xx",
  "nozomi_oono@bizstudio.co.jp": "BS1000004xx",
  "chiharu_uehara@bizstudio.co.jp": "BS1000005xx",
  "akira_murakami@bizstudio.co.jp": "BS1000006xx",
  "kanako_okada@bizstudio.co.jp": "BS1000007xx",
  "yoshitomi_ando@bizstudio.co.jp": "BS1000008xx",
  "yuzo_nanjo@bizstudio.co.jp": "BS1000009xx",
  "aoi_sato@bizstudio.co.jp": "BS1000025xx",
};

async function main() {
  console.log("=== Setting passwords for all employees ===");

  for (const [email, password] of Object.entries(employeePasswords)) {
    const passwordHash = await bcrypt.hash(password, 10);
    
    try {
      const result = await prisma.user.update({
        where: { email },
        data: { passwordHash },
      });
      console.log(`Updated: ${result.name} (${email}) -> ${password}`);
    } catch (e) {
      console.log(`Skipped: ${email} (not found)`);
    }
  }

  console.log("\n=== Complete ===");
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
