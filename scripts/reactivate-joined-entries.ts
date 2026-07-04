/**
 * 入社済エントリーの isActive 復旧スクリプト
 *
 * 過去に entryFlag='入社済' へ変更した際、旧 INACTIVE_TRIGGERS のロジックで
 * isActive=false（無効）に自動化されていたレコードを isActive=true に戻す。
 *
 * 集計依存: 実績集計（weeklyMatrix.ts, dailyReport/metrics.ts）は
 * 「無効（isActive=false）含む」明記のため isActive を絞込条件に使っていない。
 * 実績数値には影響しない（今回の再有効化で 実績表・日報の集計値は変化しない）。
 *
 * 対象: entryFlag='入社済' AND isActive=false
 * 動作: isActive=true にのみ更新。archivedAt は触らない（アーカイブは別軸）。
 * 冪等: 既に isActive=true のレコードは対象外。何度実行しても安全。
 *
 * 実行（本番コンテナ上）:
 *   railway ssh
 *     npx tsx scripts/reactivate-joined-entries.ts             # DRY-RUN
 *     npx tsx scripts/reactivate-joined-entries.ts --dry-run   # DRY-RUN
 *     npx tsx scripts/reactivate-joined-entries.ts --execute   # 本実行
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const EXECUTE = process.argv.includes("--execute");
const MODE = EXECUTE ? "EXECUTE" : "DRY-RUN";

async function main() {
  console.log(`=== 入社済エントリー isActive 復旧 (mode=${MODE}) ===`);

  const targets = await prisma.jobEntry.findMany({
    where: { entryFlag: "入社済", isActive: false },
    select: {
      id: true,
      candidateId: true,
      companyName: true,
      entryDate: true,
      joinDate: true,
      archivedAt: true,
      candidate: {
        select: {
          candidateNumber: true,
          name: true,
        },
      },
    },
    orderBy: [{ entryDate: "desc" }],
  });

  console.log(`\n対象: ${targets.length}件 (entryFlag='入社済' AND isActive=false)`);
  const archivedCount = targets.filter((t) => t.archivedAt != null).length;
  console.log(`  うち archivedAt あり: ${archivedCount}件（archivedAt は変更せず isActive のみ復旧）`);

  console.log(`\n=== 対象一覧 ===`);
  console.log("candidateNumber, 氏名, 企業名, entryDate, joinDate, archivedAt");
  for (const t of targets) {
    const num = t.candidate.candidateNumber ?? "";
    const nm = t.candidate.name ?? "";
    const ed = t.entryDate ? t.entryDate.toISOString().slice(0, 10) : "";
    const jd = t.joinDate ? t.joinDate.toISOString().slice(0, 10) : "";
    const ar = t.archivedAt ? t.archivedAt.toISOString().slice(0, 10) : "";
    console.log(`  ${num} ${nm} | ${t.companyName} | ${ed} | ${jd}${ar ? ` | ARCHIVED@${ar}` : ""}`);
  }

  if (!EXECUTE) {
    console.log(`\n(DRY-RUN: 処理未実行。--execute で本実行。)`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  if (targets.length === 0) {
    console.log(`\n対象0件のため何もしません。`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  console.log(`\n=== EXECUTE ===`);
  const result = await prisma.jobEntry.updateMany({
    where: { entryFlag: "入社済", isActive: false },
    data: { isActive: true },
  });
  console.log(`  updateMany: 更新=${result.count}件`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(1);
});
