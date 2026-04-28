import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function calculateSubStatus(candidateId: string): Promise<string> {
  const entries = await prisma.jobEntry.findMany({
    where: { candidateId },
    select: { entryFlag: true, personFlag: true, hasJoined: true },
  });

  if (entries.some((e) => e.personFlag === "入社済" || e.hasJoined === true)) return "入社済";
  if (entries.some((e) => e.entryFlag === "内定")) return "内定";
  if (entries.some((e) => e.entryFlag === "面接")) return "面接";
  if (entries.some((e) => e.entryFlag === "書類選考")) return "書類選考";
  if (entries.some((e) => e.entryFlag === "エントリー")) return "エントリー";
  if (entries.some((e) => e.entryFlag === "求人紹介")) return "求人紹介";

  const [exportedBookmarkCount, bookmarkCount] = await Promise.all([
    prisma.candidateFile.count({
      where: { candidateId, category: "BOOKMARK", lastExportedAt: { not: null } },
    }),
    prisma.candidateFile.count({
      where: { candidateId, category: "BOOKMARK" },
    }),
  ]);
  if (exportedBookmarkCount > 0) return "求人紹介";
  if (bookmarkCount > 0) return "BM";

  return "求人紹介前";
}

async function main() {
  const execute = process.argv.includes("--execute");
  const dryRun = !execute;

  console.log("==============================================");
  console.log("内定→入社済 entryFlag一括マイグレーション");
  console.log(`モード: ${dryRun ? "DRY RUN（変更なし）" : "本番実行"}`);
  console.log("==============================================\n");

  const targets = await prisma.jobEntry.findMany({
    where: { entryFlag: "内定", personFlag: "入社済" },
    select: {
      id: true,
      candidateId: true,
      companyName: true,
      entryFlag: true,
      entryFlagDetail: true,
      companyFlag: true,
      personFlag: true,
      candidate: { select: { name: true, candidateNumber: true } },
    },
  });

  console.log(`対象レコード: ${targets.length} 件\n`);

  if (targets.length === 0) {
    console.log("対象なし。終了します。");
    return;
  }

  const sample = targets.slice(0, 10);
  console.log("サンプル（最大10件）:");
  for (const t of sample) {
    console.log(
      `  ${t.candidate.candidateNumber} ${t.candidate.name} | ${t.companyName} | ` +
      `entryFlag: ${t.entryFlag} → 入社済 | entryFlagDetail: ${t.entryFlagDetail} → (null)`
    );
  }
  if (targets.length > 10) {
    console.log(`  ... 他 ${targets.length - 10} 件`);
  }

  if (dryRun) {
    console.log("\n※ DRY RUN のため変更は適用されていません。");
    console.log("※ 本番実行するには --execute を付けてください。");
    return;
  }

  console.log("\n更新を実行中...");

  const result = await prisma.jobEntry.updateMany({
    where: { entryFlag: "内定", personFlag: "入社済" },
    data: { entryFlag: "入社済", entryFlagDetail: null },
  });

  console.log(`entryFlag更新完了: ${result.count} 件`);

  const uniqueCandidateIds = [...new Set(targets.map((t) => t.candidateId))];
  console.log(`\n中項目再計算: ${uniqueCandidateIds.length} 名分...`);

  let recalcCount = 0;
  for (const candidateId of uniqueCandidateIds) {
    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { supportStatus: true },
    });
    if (!candidate || candidate.supportStatus !== "ACTIVE") continue;

    const next = await calculateSubStatus(candidateId);
    await prisma.candidate.update({
      where: { id: candidateId },
      data: { supportSubStatus: next },
    });
    recalcCount++;
  }

  console.log(`中項目再計算完了: ${recalcCount} 名`);

  const afterCount = await prisma.jobEntry.count({
    where: { entryFlag: "内定", personFlag: "入社済" },
  });

  console.log("\n==============================================");
  console.log("結果:");
  console.log(`  対象: ${targets.length} 件`);
  console.log(`  更新: ${result.count} 件`);
  console.log(`  中項目再計算: ${recalcCount} 名`);
  console.log(`  残留（entryFlag=内定 AND personFlag=入社済）: ${afterCount} 件`);
  console.log("==============================================");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
