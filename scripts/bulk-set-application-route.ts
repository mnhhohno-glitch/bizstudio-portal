/**
 * T-064: applicationRoute=null の Candidate を一括で "スカウト" + "マイナビ転職" に設定
 *
 * 実行:
 *   npx tsx scripts/bulk-set-application-route.ts --dry-run   # 件数確認のみ
 *   npx tsx scripts/bulk-set-application-route.ts             # 本実行
 *
 * 背景:
 *   将幸さん確認: Candidate の 95% は「スカウト経由 + マイナビ転職」。
 *   applicationRoute=null の 3,833件を一括で書き換え、過去データを集計対象に乗せる。
 *   5%の例外は後で個別修正する想定。
 *
 * 仕様:
 *   - applicationRoute=null のレコードのみ対象（既に値があるものは触らない）
 *   - applicationRoute = "スカウト" を全件設定
 *   - mediaSource=null のレコードのみ "マイナビ転職" を設定（既に値があるものは触らない）
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("=== T-064 applicationRoute 一括設定バッチ ===");
  console.log(`モード: ${dryRun ? "DRY RUN（書き込みなし）" : "本実行（DB書き込み）"}`);
  console.log(`開始時刻: ${new Date().toISOString()}\n`);

  // 対象件数を確認
  const targetCount = await prisma.candidate.count({
    where: { applicationRoute: null },
  });
  console.log(`対象件数 (applicationRoute=null): ${targetCount}件`);

  // mediaSource 別 / recruiterName 内訳の事前分析
  const targets = await prisma.candidate.findMany({
    where: { applicationRoute: null },
    select: { id: true, mediaSource: true, recruiterName: true, createdAt: true },
  });

  const mediaSourceBreakdown = targets.reduce(
    (acc, c) => {
      const key = c.mediaSource ?? "(null)";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  console.log("\nmediaSource 別内訳:");
  Object.entries(mediaSourceBreakdown)
    .sort((a, b) => b[1] - a[1])
    .forEach(([key, val]) => console.log(`  ${key}: ${val}件`));

  const recruiterBreakdown = {
    has_recruiter: targets.filter((c) => c.recruiterName && c.recruiterName.trim() !== "").length,
    no_recruiter: targets.filter((c) => !c.recruiterName || c.recruiterName.trim() === "").length,
  };
  console.log("\nrecruiterName 内訳:");
  console.log(`  recruiterName あり: ${recruiterBreakdown.has_recruiter}件`);
  console.log(`  recruiterName なし/空: ${recruiterBreakdown.no_recruiter}件`);

  // createdAt の最古・最新を集計（対象レコード内）
  const sorted = [...targets].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (sorted.length > 0) {
    console.log("\n対象レコードの createdAt 範囲:");
    console.log(`  最古: ${sorted[0].createdAt.toISOString()}`);
    console.log(`  最新: ${sorted[sorted.length - 1].createdAt.toISOString()}`);
  }

  // mediaSource=null の件数（更新対象）
  const mediaSourceNullCount = targets.filter((c) => !c.mediaSource).length;
  console.log(`\nmediaSource=null の件数（"マイナビ転職" 設定対象）: ${mediaSourceNullCount}件`);

  if (dryRun) {
    console.log("\n[DRY RUN] 書き込みはスキップしました。");
    console.log(`\n本実行で見込まれる更新:`);
    console.log(`  applicationRoute: ${targetCount}件 → "スカウト"`);
    console.log(`  mediaSource: ${mediaSourceNullCount}件 → "マイナビ転職"`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  // 本実行
  console.log("\n=== 一括更新開始 ===");
  const startTime = Date.now();

  // 1. applicationRoute = "スカウト" を全件設定
  const updateRouteResult = await prisma.candidate.updateMany({
    where: { applicationRoute: null },
    data: { applicationRoute: "スカウト" },
  });
  console.log(`  applicationRoute 更新: ${updateRouteResult.count}件`);

  // 2. mediaSource = "マイナビ転職" を mediaSource=null のものに設定
  //    （直前の更新で applicationRoute='スカウト' になったレコード群のうち mediaSource=null）
  const updateMediaResult = await prisma.candidate.updateMany({
    where: { mediaSource: null, applicationRoute: "スカウト" },
    data: { mediaSource: "マイナビ転職" },
  });
  console.log(`  mediaSource 更新: ${updateMediaResult.count}件`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const endTime = new Date().toISOString();
  console.log(`\n=== 完了 ===`);
  console.log(`所要時間: ${elapsed}秒`);
  console.log(`終了時刻: ${endTime}`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
