import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = "masayuki_oono@bizstudio.co.jp";
  const newPassword = "BS1000001xx";
  
  const passwordHash = await bcrypt.hash(newPassword, 10);
  
  const result = await prisma.user.update({
    where: { email },
    data: { passwordHash },
  });
  
  console.log(`Password updated for: ${result.name} (${result.email})`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
