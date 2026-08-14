/**
 * T-163: 過去の求人分析メッセージへの kind="ANALYSIS" バックフィル（冪等）
 *
 * チャットAPI（advisor/sessions/[sessionId]/messages）は isAnalysisMessage で
 * 「kind または 本文プレフィクス」の両方を判定するため、本バックフィルが未完了でも
 * 動作は正しい。kind を埋めるのは判定の高速化・データの自己記述性のため。
 *
 * 対象: advisor_chat_messages の kind IS NULL かつ本文が
 *   「【求人分析 バッチ」「【求人分析 完了」「ブックマーク求人分析」のいずれかで始まる行
 * 更新: kind = 'ANALYSIS' を新規カラムにのみ UPDATE（他カラムは一切触らない）
 *
 * 実行:
 *   # DRY RUN（既定・DB 書き込みなし・対象件数と role別内訳を出力）
 *   npx tsx scripts/backfill-advisor-message-kind.ts --dry-run
 *   npx tsx scripts/backfill-advisor-message-kind.ts
 *
 *   # 本番実行（DB 書き込み）
 *   npx tsx scripts/backfill-advisor-message-kind.ts --execute
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// 判定は src/lib/advisor-message-kind.ts の isAnalysisMessage と同一の本文プレフィクス。
// （kind IS NULL 条件があるため、ここでは本文側のみを見る）
const PREFIXES = ["【求人分析 バッチ", "【求人分析 完了", "ブックマーク求人分析"] as const;

async function main() {
  const execute = process.argv.includes("--execute");

  const where = {
    kind: null,
    OR: PREFIXES.map((p) => ({ content: { startsWith: p } })),
  };

  // 対象件数と role 別内訳（必ず先に出力）
  const byRole = await prisma.advisorChatMessage.groupBy({
    by: ["role"],
    where,
    _count: { _all: true },
  });
  const total = byRole.reduce((s, r) => s + r._count._all, 0);

  console.log(`[backfill-advisor-message-kind] mode=${execute ? "EXECUTE" : "DRY-RUN"}`);
  console.log(`対象件数: ${total}件`);
  for (const r of byRole) {
    console.log(`  role=${r.role}: ${r._count._all}件`);
  }

  // プレフィクス別内訳（確認用）
  for (const p of PREFIXES) {
    const n = await prisma.advisorChatMessage.count({
      where: { kind: null, content: { startsWith: p } },
    });
    console.log(`  prefix「${p}」: ${n}件`);
  }

  if (!execute) {
    console.log("DRY-RUN のため書き込みなし。実行する場合は --execute を付けること。");
    return;
  }

  const result = await prisma.advisorChatMessage.updateMany({
    where,
    data: { kind: "ANALYSIS" },
  });
  console.log(`UPDATE 完了: ${result.count}件に kind='ANALYSIS' を設定`);

  // 冪等性の確認（再実行時は 0 件になる）
  const remaining = await prisma.advisorChatMessage.count({ where });
  console.log(`残り対象: ${remaining}件（0 であること）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
