import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const MAPPING: Record<string, string | null> = {
  "週明け月曜日": "送付予定",
  "今週中": "送付予定",
  "未定": null,
  "送付済": null,
};

async function main() {
  const args = process.argv.slice(2);
  const isExecute = args.includes("--execute");
  const isDryRun = args.includes("--dry-run") || !isExecute;

  if (isExecute && isDryRun && args.includes("--dry-run")) {
    console.error("--dry-run と --execute は同時指定できません");
    process.exit(1);
  }

  console.log(`[T-051 migrate-document-sending-plan] mode=${isExecute ? "EXECUTE" : "DRY-RUN"}`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const distribution = await prisma.interviewDetail.groupBy({
      by: ["jobReferralFlag"],
      _count: { jobReferralFlag: true },
      where: { jobReferralFlag: { not: null } },
    });

    console.log("\n[現在の jobReferralFlag 分布]:");
    for (const r of distribution) {
      const mapped = r.jobReferralFlag !== null && Object.prototype.hasOwnProperty.call(MAPPING, r.jobReferralFlag);
      const marker = mapped ? "✓" : "・";
      console.log(`  ${marker} ${r.jobReferralFlag}: ${r._count.jobReferralFlag}`);
    }

    let totalTarget = 0;
    console.log("\n[マッピング対象 (件数 / 旧→新)]:");
    for (const [oldVal, newVal] of Object.entries(MAPPING)) {
      const count = await prisma.interviewDetail.count({
        where: { jobReferralFlag: oldVal },
      });
      totalTarget += count;
      console.log(`  ${count}件: "${oldVal}" → ${newVal === null ? "NULL" : `"${newVal}"`}`);
    }
    console.log(`\n[合計マッピング対象]: ${totalTarget}件`);

    const unmapped = distribution.filter(
      (r) => r.jobReferralFlag !== null && !Object.prototype.hasOwnProperty.call(MAPPING, r.jobReferralFlag)
    );
    if (unmapped.length > 0) {
      console.log("\n[⚠ マッピング外の旧値 (UPDATE 対象外、新UIで未表示になる可能性)]:");
      for (const r of unmapped) {
        console.log(`  ${r.jobReferralFlag}: ${r._count.jobReferralFlag}`);
      }
    }

    if (!isExecute) {
      console.log("\n[DRY-RUN] DB 更新は実行されませんでした。--execute で実行してください。");
      return;
    }

    console.log("\n[EXECUTE] DB 更新を実行します...");
    let updated = 0;
    for (const [oldVal, newVal] of Object.entries(MAPPING)) {
      const res = await prisma.interviewDetail.updateMany({
        where: { jobReferralFlag: oldVal },
        data: { jobReferralFlag: newVal },
      });
      console.log(`  "${oldVal}" → ${newVal === null ? "NULL" : `"${newVal}"`}: ${res.count}件 更新`);
      updated += res.count;
    }
    console.log(`\n[合計更新件数]: ${updated}件`);

    const after = await prisma.interviewDetail.groupBy({
      by: ["jobReferralFlag"],
      _count: { jobReferralFlag: true },
      where: { jobReferralFlag: { not: null } },
    });
    console.log("\n[更新後の jobReferralFlag 分布]:");
    for (const r of after) {
      console.log(`  ${r.jobReferralFlag}: ${r._count.jobReferralFlag}`);
    }
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
