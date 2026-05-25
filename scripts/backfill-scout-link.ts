/**
 * T-064: 過去応募者の自動紐付け一括バッチ
 *
 * 既存の `src/lib/scout/auto-link.ts` の autoLinkCandidateToSlot を流用し、
 * Candidate (applicationRoute=スカウト, scoutDeliverySlotId=null, createdAt >= 2026-01-11) に対し
 * 一括で再試行する。
 *
 * 実行:
 *   # DRY RUN（findMatchingSlot だけ呼んで件数を集計、DB 書き込みなし）
 *   npx tsx scripts/backfill-scout-link.ts --dry-run
 *
 *   # 本番実行（DB に書き込み）
 *   npx tsx scripts/backfill-scout-link.ts
 *
 * 安全策: 引数なしの場合は本番実行モードとなるため、
 * 必ず DRY RUN で件数確認 → 将幸さんの OK を得てから本実行すること。
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import {
  autoLinkCandidateToSlot,
  findMatchingSlot,
  type AutoLinkReason,
} from "../src/lib/scout/auto-link";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TARGET_CREATED_AT_FROM = new Date("2026-01-11T00:00:00Z");

type ResultCounts = Record<AutoLinkReason, number> & { total: number };

function newCounts(): ResultCounts {
  return {
    total: 0,
    matched: 0,
    no_machine_master: 0,
    no_candidate_today: 0,
    no_candidate_yesterday: 0,
    no_recruiter_name: 0,
    error: 0,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("\n=== T-064 過去応募者 自動紐付けバッチ ===");
  console.log(`モード: ${dryRun ? "DRY RUN（DB書き込みなし）" : "本番実行（DB書き込み）"}`);
  console.log(`対象期間: ${TARGET_CREATED_AT_FROM.toISOString()} 以降`);

  const startedAt = new Date();
  console.log(`開始時刻: ${startedAt.toISOString()}\n`);

  const candidates = await prisma.candidate.findMany({
    where: {
      applicationRoute: "スカウト",
      scoutDeliverySlotId: null,
      createdAt: { gte: TARGET_CREATED_AT_FROM },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      recruiterName: true,
      createdAt: true,
    },
  });

  console.log(`対象 Candidate: ${candidates.length}件\n`);

  const results = newCounts();
  results.total = candidates.length;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];

    if (dryRun) {
      // DRY RUN: findMatchingSlot のみ呼んで集計（DB 書き込みなし）
      if (!c.recruiterName?.trim()) {
        results.no_recruiter_name++;
      } else {
        try {
          const slot = await findMatchingSlot({
            recruiterName: c.recruiterName,
            applicationDate: c.createdAt,
          });
          if (slot) {
            results.matched++;
          } else {
            // machine の有無を別途確認するためには内部メソッドが必要だが、
            // findMatchingSlot の null 戻りは「machine 無し」or「slot 無し」両方を含む。
            // 集計上は no_candidate_yesterday に括る（旧 PR の挙動と一致）。
            results.no_candidate_yesterday++;
          }
        } catch (e) {
          console.error(`[error] candidate=${c.id}:`, e);
          results.error++;
        }
      }
    } else {
      const result = await autoLinkCandidateToSlot({
        candidateId: c.id,
        recruiterName: c.recruiterName,
        applicationDate: c.createdAt,
      });
      results[result.reason]++;
    }

    if ((i + 1) % 100 === 0) {
      console.log(`進捗: ${i + 1}/${candidates.length}件処理済み`);
    }
  }

  const endedAt = new Date();
  const elapsedSec = (endedAt.getTime() - startedAt.getTime()) / 1000;

  console.log("\n=== 結果 ===");
  console.log(`モード: ${dryRun ? "DRY RUN" : "本番実行"}`);
  console.log(`対象: ${results.total}件`);
  console.log(`紐付け成功 (matched): ${results.matched}件`);
  console.log(`担当者マスタ未マッチ (no_machine_master): ${results.no_machine_master}件`);
  console.log(`同日スロット無し (no_candidate_today): ${results.no_candidate_today}件`);
  console.log(`前日も無し (no_candidate_yesterday): ${results.no_candidate_yesterday}件`);
  console.log(`recruiterName 空 (no_recruiter_name): ${results.no_recruiter_name}件`);
  console.log(`エラー (error): ${results.error}件`);
  console.log(`所要時間: ${elapsedSec.toFixed(1)}秒 (開始=${startedAt.toISOString()} / 終了=${endedAt.toISOString()})`);

  if (dryRun) {
    console.log(
      "\n⚠️ DRY RUN モードのため DB 書き込みはしていません。本実行は将幸さんの OK 後、引数なしで再実行してください。",
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
