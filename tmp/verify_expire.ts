import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
(async () => {
  // 1. 「未応募」化された件数（今日変更されたもの）
  const noApp = await prisma.jobEntry.count({
    where: { entryFlag: "求人紹介", entryFlagDetail: "未応募", isActive: false },
  });
  // 2. その中で companyFlag や personFlag に「辞退」系が入っているもの（あってはいけない）
  const wronglySet = await prisma.jobEntry.count({
    where: {
      entryFlag: "求人紹介",
      entryFlagDetail: "未応募",
      OR: [
        { companyFlag: { in: ["辞退報告前", "辞退報告済"] } },
        { personFlag: "辞退受付済" },
      ],
    },
  });
  // 3. 現在の「求人紹介」タブ（entryFlag=求人紹介, isActive=true）残数
  const active = await prisma.jobEntry.count({
    where: { entryFlag: "求人紹介", isActive: true },
  });
  // 4. 「求人紹介」タブで 2026-05-05 以前 entryDate の残（ゼロのはず）
  const oldActive = await prisma.jobEntry.count({
    where: {
      entryFlag: "求人紹介",
      isActive: true,
      entryDate: { lt: new Date("2026-05-05T15:00:00.000Z") },
    },
  });
  console.log(JSON.stringify({
    no_app_inactive_count: noApp,
    wrongly_set_withdrawal_flags: wronglySet,
    remaining_active_in_tab: active,
    old_active_should_be_zero: oldActive,
  }, null, 2));
  await prisma.$disconnect();
  await pool.end();
})();
