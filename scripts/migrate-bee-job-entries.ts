/**
 * T-028 Bee 媒体誤記録の portal 側修正スクリプト
 *
 * kyuujinPDF 側で修正された 7 件に対応する JobEntry レコードを修正:
 * - jobDb: HITO-Link → Bee
 * - companyName: 末尾の「：数字」サフィックスを除去
 * - jobType: doda掲載求人 / DODA求人 / パーソル求人 → ネオキャリア求人
 *
 * 使い方:
 *   dry-run:  npx tsx scripts/migrate-bee-job-entries.ts --dry-run
 *   本番実行:  npx tsx scripts/migrate-bee-job-entries.ts --execute
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// kyuujinPDF 側で修正された Job.id（portal 側の externalJobId と一致）
const TARGET_EXTERNAL_JOB_IDS = [4559, 4560, 4570, 4572, 4574, 4575, 4579];

const SUFFIX_PATTERN = /[：:]\d+$/;

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const isExecute = args.includes("--execute");

  if (!isDryRun && !isExecute) {
    console.error("Usage: --dry-run | --execute");
    process.exit(1);
  }

  const targets = await prisma.jobEntry.findMany({
    where: { externalJobId: { in: TARGET_EXTERNAL_JOB_IDS } },
    select: {
      id: true,
      externalJobId: true,
      companyName: true,
      jobDb: true,
      jobType: true,
      candidateId: true,
    },
  });

  console.log(`\n対象レコード: ${targets.length} 件\n`);
  console.log(
    "externalJobId | candidateId       | current_co                          | new_co                       | current_db | current_type"
  );
  console.log("-".repeat(160));

  for (const t of targets) {
    const newCo = (t.companyName ?? "").replace(SUFFIX_PATTERN, "");
    console.log(
      `${String(t.externalJobId).padStart(13)} | ${(t.candidateId ?? "").padEnd(17)} | ` +
        `${(t.companyName ?? "").padEnd(35).slice(0, 35)} | ${newCo.padEnd(28).slice(0, 28)} | ` +
        `${(t.jobDb ?? "").padEnd(10)} | ${(t.jobType ?? "").padEnd(12)}`
    );
  }

  if (isDryRun) {
    console.log("\n[DRY-RUN] 変更は行いません。問題なければ --execute を付けて再実行してください。");
    return;
  }

  // 本番実行
  console.log("\n[EXECUTE] DB更新を実行します...");
  let updatedCount = 0;
  for (const t of targets) {
    const newCo = (t.companyName ?? "").replace(SUFFIX_PATTERN, "");
    await prisma.jobEntry.update({
      where: { id: t.id },
      data: {
        jobDb: "Bee",
        companyName: newCo,
        jobType: "ネオキャリア求人",
      },
    });
    updatedCount++;
  }
  console.log(`[DONE] ${updatedCount} 件を更新しました。`);

  // 検証
  const beeCount = await prisma.jobEntry.count({ where: { jobDb: "Bee" } });
  const hitoCount = await prisma.jobEntry.count({ where: { jobDb: "HITO-Link" } });
  console.log(`\n更新後の件数:`);
  console.log(`  Bee: ${beeCount} 件`);
  console.log(`  HITO-Link: ${hitoCount} 件`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
