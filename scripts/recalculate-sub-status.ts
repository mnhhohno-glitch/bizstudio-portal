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
  const dryRun = process.argv.includes("--dry-run");

  console.log("==============================================");
  console.log("supportSubStatus 一括再計算スクリプト");
  console.log(`モード: ${dryRun ? "DRY RUN（変更なし）" : "本番実行"}`);
  console.log("==============================================\n");

  const candidates = await prisma.candidate.findMany({
    where: { supportStatus: "ACTIVE" },
    select: {
      id: true,
      candidateNumber: true,
      name: true,
      supportSubStatus: true,
      supportSubStatusManual: true,
    },
    orderBy: { candidateNumber: "asc" },
  });

  console.log(`対象（ACTIVE）: ${candidates.length} 件\n`);

  let changedCount = 0;
  let unchangedCount = 0;

  for (const c of candidates) {
    const calculated = await calculateSubStatus(c.id);
    const current = c.supportSubStatus || "";

    if (current !== calculated) {
      changedCount++;
      console.log(
        `[変更] ${c.candidateNumber} ${c.name}: ${current || "(空)"} → ${calculated}` +
          (c.supportSubStatusManual ? " (手動→自動に切替)" : "")
      );
      if (!dryRun) {
        await prisma.candidate.update({
          where: { id: c.id },
          data: {
            supportSubStatus: calculated,
            supportSubStatusManual: false,
          },
        });
      }
    } else {
      unchangedCount++;
      if (c.supportSubStatusManual && !dryRun) {
        await prisma.candidate.update({
          where: { id: c.id },
          data: { supportSubStatusManual: false },
        });
      }
    }
  }

  console.log("\n==============================================");
  console.log("結果:");
  console.log(`  対象: ${candidates.length} 件`);
  console.log(`  変更: ${changedCount} 件`);
  console.log(`  変更なし: ${unchangedCount} 件`);
  if (dryRun) {
    console.log("\n※ DRY RUN のため変更は適用されていません。");
    console.log("※ 本番実行するには --dry-run を外してください。");
  }
  console.log("==============================================");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
