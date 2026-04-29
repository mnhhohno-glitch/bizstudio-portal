import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const VALID_MEDIUMS = new Set([
  "会社都合", "個人都合", "環境要因",
  "キャリア志向", "働き方の見直し", "将来設計",
]);

const AUTO_FIX_MAP: Record<string, string> = {
  "キャリア要因": "キャリア志向",
};

async function main() {
  const execute = process.argv.includes("--execute");
  const dryRun = !execute;

  console.log("==============================================");
  console.log("退職理由 中項目 不整合値修正");
  console.log(`モード: ${dryRun ? "DRY RUN（変更なし）" : "本番実行"}`);
  console.log("==============================================\n");

  const all = await prisma.workHistory.findMany({
    where: {
      resignReasonMedium: { not: null },
      NOT: { resignReasonMedium: "" },
    },
    select: {
      id: true,
      companyName: true,
      resignReasonLarge: true,
      resignReasonMedium: true,
      resignReasonSmall: true,
      interviewRecord: {
        select: { candidate: { select: { name: true, candidateNumber: true } } },
      },
    },
  });

  const invalid = all.filter((r) => !VALID_MEDIUMS.has(r.resignReasonMedium!));

  console.log(`全レコード: ${all.length} 件`);
  console.log(`不整合値: ${invalid.length} 件\n`);

  if (invalid.length === 0) {
    console.log("不整合値なし。終了します。");
    return;
  }

  let fixed = 0;
  let skipped = 0;

  for (const r of invalid) {
    const cand = r.interviewRecord.candidate;
    const fixTo = AUTO_FIX_MAP[r.resignReasonMedium!];

    if (fixTo) {
      console.log(
        `  [修正] ${cand.candidateNumber} ${cand.name} | ${r.companyName} | ` +
        `"${r.resignReasonMedium}" → "${fixTo}"`
      );
      if (!dryRun) {
        await prisma.workHistory.update({
          where: { id: r.id },
          data: { resignReasonMedium: fixTo },
        });
      }
      fixed++;
    } else {
      console.log(
        `  [スキップ] ${cand.candidateNumber} ${cand.name} | ${r.companyName} | ` +
        `"${r.resignReasonMedium}"（自動変換不可、手動確認必要）`
      );
      skipped++;
    }
  }

  console.log("\n==============================================");
  console.log("結果:");
  console.log(`  修正: ${fixed} 件`);
  console.log(`  スキップ: ${skipped} 件`);
  if (dryRun) {
    console.log("\n※ DRY RUN のため変更は適用されていません。");
    console.log("※ 本番実行するには --execute を付けてください。");
  }
  console.log("==============================================");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
