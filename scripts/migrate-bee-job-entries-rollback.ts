/**
 * T-028 portal 側修正のロールバック用スクリプト
 *
 * 注意: dry-run 時点で取得した元の値を ROLLBACK_DATA にハードコードする想定。
 * dry-run 結果から元の jobDb / jobType / companyName を控えておき、本ファイルに記載してから実行する。
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// dry-run 結果から控えた元の値を記載
// 形式: externalJobId => { jobDb, jobType, companyName }
const ROLLBACK_DATA: Record<number, { jobDb: string; jobType: string; companyName: string }> = {
  // 例:
  // 4559: { jobDb: "HITO-Link", jobType: "doda掲載求人", companyName: "株式会社エス・エム・エス：123202" },
  // 実行前に dry-run 結果から記載すること
};

async function main() {
  const args = process.argv.slice(2);
  const isExecute = args.includes("--execute");

  if (Object.keys(ROLLBACK_DATA).length === 0) {
    console.error("ROLLBACK_DATA が空です。dry-run 結果から元の値を記載してください。");
    process.exit(1);
  }

  for (const [externalJobIdStr, orig] of Object.entries(ROLLBACK_DATA)) {
    const externalJobId = Number(externalJobIdStr);
    const entries = await prisma.jobEntry.findMany({
      where: { externalJobId },
    });
    for (const entry of entries) {
      console.log(`externalJobId=${externalJobId}: ${entry.companyName} → ${orig.companyName}`);
      if (isExecute) {
        await prisma.jobEntry.update({
          where: { id: entry.id },
          data: {
            jobDb: orig.jobDb,
            jobType: orig.jobType,
            companyName: orig.companyName,
          },
        });
      }
    }
  }

  if (isExecute) {
    console.log("[DONE] ロールバック完了");
  } else {
    console.log("[DRY-RUN]");
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
