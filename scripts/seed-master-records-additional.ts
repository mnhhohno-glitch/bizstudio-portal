import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const execute = process.argv.includes("--execute");
  const dryRun = !execute;

  console.log("==============================================");
  console.log("マスタレコード追加（指定なし + 23区）");
  console.log(`モード: ${dryRun ? "DRY RUN（変更なし）" : "本番実行"}`);
  console.log("==============================================\n");

  let created = 0;
  let skipped = 0;

  // --- 1. 業種「指定なし」3階層 ---
  console.log("--- 業種「指定なし」---");
  let indMajor = await prisma.industryCategoryMajor.findFirst({ where: { name: "指定なし" } });
  if (indMajor) {
    console.log(`  major: 既存 (id=${indMajor.id})`);
    skipped++;
  } else {
    console.log(`  major: 追加予定 (sortOrder=0)`);
    if (!dryRun) {
      indMajor = await prisma.industryCategoryMajor.create({
        data: { name: "指定なし", sortOrder: 0 },
      });
      console.log(`  major: 作成完了 (id=${indMajor.id})`);
    }
    created++;
  }

  if (indMajor) {
    let indMiddle = await prisma.industryCategoryMiddle.findFirst({
      where: { majorId: indMajor.id, name: "指定なし" },
    });
    if (indMiddle) {
      console.log(`  middle: 既存 (id=${indMiddle.id})`);
      skipped++;
    } else {
      console.log(`  middle: 追加予定`);
      if (!dryRun) {
        indMiddle = await prisma.industryCategoryMiddle.create({
          data: { name: "指定なし", majorId: indMajor.id, sortOrder: 0 },
        });
        console.log(`  middle: 作成完了 (id=${indMiddle.id})`);
      }
      created++;
    }

    if (indMiddle) {
      const indMinor = await prisma.industryCategoryMinor.findFirst({
        where: { middleId: indMiddle.id, name: "指定なし" },
      });
      if (indMinor) {
        console.log(`  minor: 既存 (id=${indMinor.id})`);
        skipped++;
      } else {
        console.log(`  minor: 追加予定`);
        if (!dryRun) {
          const r = await prisma.industryCategoryMinor.create({
            data: { name: "指定なし", middleId: indMiddle.id, sortOrder: 0 },
          });
          console.log(`  minor: 作成完了 (id=${r.id})`);
        }
        created++;
      }
    }
  }

  // --- 2. 職種「指定なし」3階層 ---
  console.log("\n--- 職種「指定なし」---");
  let jobMajor = await prisma.jobCategoryMajor.findFirst({ where: { name: "指定なし" } });
  if (jobMajor) {
    console.log(`  major: 既存 (id=${jobMajor.id})`);
    skipped++;
  } else {
    console.log(`  major: 追加予定 (sortOrder=0)`);
    if (!dryRun) {
      jobMajor = await prisma.jobCategoryMajor.create({
        data: { name: "指定なし", sortOrder: 0 },
      });
      console.log(`  major: 作成完了 (id=${jobMajor.id})`);
    }
    created++;
  }

  if (jobMajor) {
    let jobMiddle = await prisma.jobCategoryMiddle.findFirst({
      where: { majorId: jobMajor.id, name: "指定なし" },
    });
    if (jobMiddle) {
      console.log(`  middle: 既存 (id=${jobMiddle.id})`);
      skipped++;
    } else {
      console.log(`  middle: 追加予定`);
      if (!dryRun) {
        jobMiddle = await prisma.jobCategoryMiddle.create({
          data: { name: "指定なし", majorId: jobMajor.id, sortOrder: 0 },
        });
        console.log(`  middle: 作成完了 (id=${jobMiddle.id})`);
      }
      created++;
    }

    if (jobMiddle) {
      const jobMinor = await prisma.jobCategoryMinor.findFirst({
        where: { middleId: jobMiddle.id, name: "指定なし" },
      });
      if (jobMinor) {
        console.log(`  minor: 既存 (id=${jobMinor.id})`);
        skipped++;
      } else {
        console.log(`  minor: 追加予定`);
        if (!dryRun) {
          const r = await prisma.jobCategoryMinor.create({
            data: { name: "指定なし", middleId: jobMiddle.id, sortOrder: 0 },
          });
          console.log(`  minor: 作成完了 (id=${r.id})`);
        }
        created++;
      }
    }
  }

  // --- 3. 東京都「23区」---
  console.log("\n--- 東京都「23区」---");
  const tokyo = await prisma.areaCategoryMiddle.findFirst({ where: { name: "東京都" } });
  if (!tokyo) {
    console.log("  エラー: 東京都の都道府県レコードが見つかりません");
  } else {
    const existing23ku = await prisma.areaCategoryMinor.findFirst({
      where: { middleId: tokyo.id, name: "23区" },
    });
    if (existing23ku) {
      console.log(`  23区: 既存 (id=${existing23ku.id})`);
      skipped++;
    } else {
      console.log(`  23区: 追加予定 (sortOrder=40, 千代田区=41の前)`);
      if (!dryRun) {
        const r = await prisma.areaCategoryMinor.create({
          data: { name: "23区", middleId: tokyo.id, sortOrder: 40 },
        });
        console.log(`  23区: 作成完了 (id=${r.id})`);
      }
      created++;
    }
  }

  console.log("\n==============================================");
  console.log("結果:");
  console.log(`  追加: ${created} 件`);
  console.log(`  既存（スキップ）: ${skipped} 件`);
  if (dryRun) {
    console.log("\n※ DRY RUN のため変更は適用されていません。");
    console.log("※ 本番実行するには --execute を付けてください。");
  }
  console.log("==============================================");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
