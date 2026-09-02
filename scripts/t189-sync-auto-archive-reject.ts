/**
 * T-189 修正: 自動配信行の「紹介保留」⇔「却下」を一度だけ同期する埋め戻し（冪等）
 *
 * 2026-09-02 決定: 自動配信行（auto_sourced_at IS NOT NULL）は紹介保留と却下を同一に扱う。
 * デプロイ後は archive/restore API・承認ページ✗・詳細タブ✗・analyze-collect の評価D自動却下が
 * 双方向に同期するが、デプロイ前に片側だけ立った行が残っているのでここで揃える。
 *
 * (A) 保留済みなのに承認待ち: archived_at IS NOT NULL AND approval_status='PENDING'
 *       → approval_status='REJECTED', rejected_reason=保留理由（archived_reason＋メモ。無ければ「紹介保留」）
 * (B) 却下済みなのに未保留:   approval_status='REJECTED' AND archived_at IS NULL
 *       → archived_at=now, archived_reason=rejected_reason（無ければ「却下」）, archived_by_id=uploaded_by_user_id（sourcedBy 相当）
 * introducedAt・supportSubStatus・既存の archived_* は触らない。
 *
 * 実行:
 *   npx tsx --env-file=.env scripts/t189-sync-auto-archive-reject.ts                       # DRY RUN（全求職者）
 *   npx tsx --env-file=.env scripts/t189-sync-auto-archive-reject.ts --candidate=5008419   # 求職者番号で絞る
 *   npx tsx --env-file=.env scripts/t189-sync-auto-archive-reject.ts --execute             # 本番実行
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function reasonFromArchive(r: string | null, n: string | null): string {
  if (r && n) return `${r}（${n}）`;
  if (r) return r;
  if (n) return n;
  return "紹介保留";
}

async function main() {
  const execute = process.argv.includes("--execute");
  const candArg = process.argv.find((a) => a.startsWith("--candidate="))?.slice("--candidate=".length);
  const scope = candArg ? { candidate: { candidateNumber: candArg } } : {};
  const select = {
    id: true, fileName: true, aiMatchRating: true, approvalStatus: true, rejectedReason: true,
    archivedAt: true, archivedReason: true, archivedNote: true, archivedById: true, uploadedByUserId: true,
    candidate: { select: { candidateNumber: true } },
  } as const;

  const a = await prisma.candidateFile.findMany({
    where: { ...scope, autoSourcedAt: { not: null }, archivedAt: { not: null }, approvalStatus: "PENDING" },
    select, orderBy: { archivedAt: "asc" },
  });
  const b = await prisma.candidateFile.findMany({
    where: { ...scope, autoSourcedAt: { not: null }, approvalStatus: "REJECTED", archivedAt: null },
    select, orderBy: { autoSourcedAt: "asc" },
  });

  console.log(`[t189-sync-auto-archive-reject] mode=${execute ? "EXECUTE" : "DRY-RUN"} scope=${candArg ?? "all"}`);
  console.log(`(A) 保留済み→REJECTED へ: ${a.length}件`);
  for (const t of a) {
    console.log(`  ${t.id}\t${t.candidate.candidateNumber}\t${t.fileName}\t総合=${t.aiMatchRating ?? "-"}\trejectedReason→${reasonFromArchive(t.archivedReason, t.archivedNote)}`);
  }
  console.log(`(B) REJECTED未保留→保留へ: ${b.length}件`);
  for (const t of b) {
    console.log(`  ${t.id}\t${t.candidate.candidateNumber}\t${t.fileName}\t総合=${t.aiMatchRating ?? "-"}\tarchivedReason→${t.rejectedReason ?? "却下"}\tarchivedBy→${t.uploadedByUserId ?? "null"}`);
  }
  if (!execute) {
    console.log("DRY-RUN: 書き込みなし。--execute で実行。");
    return;
  }
  const now = new Date();
  let ua = 0;
  let ub = 0;
  await prisma.$transaction(async (tx) => {
    for (const t of a) {
      const r = await tx.candidateFile.updateMany({
        where: { id: t.id, approvalStatus: "PENDING", archivedAt: { not: null } },
        data: { approvalStatus: "REJECTED", rejectedReason: reasonFromArchive(t.archivedReason, t.archivedNote) },
      });
      ua += r.count;
    }
    for (const t of b) {
      const r = await tx.candidateFile.updateMany({
        where: { id: t.id, approvalStatus: "REJECTED", archivedAt: null },
        data: {
          archivedAt: now,
          archivedReason: t.rejectedReason ?? "却下",
          archivedNote: null,
          archivedById: t.uploadedByUserId ?? null,
        },
      });
      ub += r.count;
    }
  });
  console.log(`updated: (A)=${ua} (B)=${ub}`);
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
