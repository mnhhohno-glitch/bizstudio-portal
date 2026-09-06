/**
 * T-189 Phase3-1: 評価 D の自動配信行を一度だけ自動却下する埋め戻し（冪等）
 *
 * analyze-collect（Phase 2a）の保存処理に「保存した aiMatchRating が D なら
 * approvalStatus=REJECTED / rejectedReason="AI評価D（自動）"」を追加した（2026-09-02 決定）。
 * デプロイ前に評価済みで PENDING のまま残っている D 行を、同じ理由で一度だけ却下する。
 *
 * 対象: candidate_files のうち auto_sourced_at IS NOT NULL AND approval_status='PENDING'
 *       AND ai_match_rating='D'
 * 更新: approval_status='REJECTED', rejected_reason='AI評価D（自動）'（archivedAt・introducedAt は触らない）
 *
 * 実行:
 *   npx tsx --env-file=.env scripts/t189-backfill-auto-reject-d.ts            # DRY RUN（件数と内訳のみ）
 *   npx tsx --env-file=.env scripts/t189-backfill-auto-reject-d.ts --execute  # 本番実行
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const AUTO_REJECT_REASON_D = "AI評価D（自動）"; // src/lib/recommend/auto-approval-shared.ts と同一文字列

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const execute = process.argv.includes("--execute");
  const where = { autoSourcedAt: { not: null }, approvalStatus: "PENDING", aiMatchRating: "D" } as const;

  const targets = await prisma.candidateFile.findMany({
    where,
    select: { id: true, candidateId: true, fileName: true, aiAnalyzedAt: true, candidate: { select: { candidateNumber: true } } },
    orderBy: { aiAnalyzedAt: "asc" },
  });
  console.log(`[t189-backfill-auto-reject-d] mode=${execute ? "EXECUTE" : "DRY-RUN"} targets=${targets.length}`);
  for (const t of targets) {
    console.log(`  ${t.id}\t${t.candidate.candidateNumber}\t${t.fileName}\tanalyzedAt=${t.aiAnalyzedAt?.toISOString() ?? "-"}`);
  }
  if (!execute) {
    console.log("DRY-RUN: 書き込みなし。--execute で実行。");
    return;
  }
  const r = await prisma.candidateFile.updateMany({
    where,
    data: { approvalStatus: "REJECTED", rejectedReason: AUTO_REJECT_REASON_D },
  });
  console.log(`updated=${r.count}`);
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

export {};
