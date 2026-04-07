/**
 * 既存マイページ反応の一括同期スクリプト
 *
 * bizstudio-mypageで既に「応募したい」「気になる」を選択済みの求人について、
 * ポータルのCandidateJobResponseテーブルに反映する。
 *
 * Usage:
 *   npx tsx scripts/sync-mypage-responses.ts --dry-run   # 確認のみ
 *   npx tsx scripts/sync-mypage-responses.ts              # 実行
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DRY_RUN = process.argv.includes("--dry-run");

const KYUUJIN_API_URL = process.env.KYUUJIN_API_URL || "https://web-production-95808.up.railway.app";
const KYUUJIN_API_SECRET = process.env.KYUUJIN_API_SECRET;

type MypageFeedback = {
  job_seeker_id: string;
  job_id: number;
  response: string; // "WANT_TO_APPLY" | "INTERESTED"
  responded_at: string;
};

async function fetchAllFeedbacks(): Promise<MypageFeedback[]> {
  if (!KYUUJIN_API_SECRET) {
    throw new Error("KYUUJIN_API_SECRET is not set");
  }

  console.log(`[Sync] Fetching feedbacks from ${KYUUJIN_API_URL}/api/external/mypage/feedbacks ...`);

  const res = await fetch(`${KYUUJIN_API_URL}/api/external/mypage/feedbacks`, {
    headers: {
      "x-api-secret": KYUUJIN_API_SECRET,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Feedbacks API error: ${res.status} ${res.statusText}\n${text}`);
  }

  const data = await res.json();
  return data.feedbacks || data;
}

async function main() {
  console.log(`[Sync] Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log("");

  // 1. フィードバック一覧を取得
  let feedbacks: MypageFeedback[];
  try {
    feedbacks = await fetchAllFeedbacks();
  } catch (error) {
    console.error("[Sync] Failed to fetch feedbacks:", error);
    console.log("");
    console.log("=== フォールバック: ポータルDBの全候補者の求人を確認 ===");
    console.log("マイページAPIにフィードバック一覧エンドポイントがない場合、");
    console.log("bizstudio-mypage側にエンドポイントを追加してから再実行してください。");
    console.log("");
    console.log("期待するAPI仕様:");
    console.log("  GET /api/external/mypage/feedbacks");
    console.log("  Headers: x-api-secret");
    console.log("  Response: { feedbacks: [{ job_seeker_id, job_id, response, responded_at }] }");
    return;
  }

  console.log(`[Sync] Fetched ${feedbacks.length} feedbacks`);

  // 2. 候補者マッピング（candidateNumber → candidateId）
  const candidates = await prisma.candidate.findMany({
    select: { id: true, candidateNumber: true },
  });
  const candidateMap = new Map(candidates.map((c) => [c.candidateNumber, c.id]));
  console.log(`[Sync] Loaded ${candidates.length} candidates from portal DB`);

  // 3. 既存のレスポンスを確認（上書きしない）
  const existingResponses = await prisma.candidateJobResponse.findMany({
    select: { candidateId: true, externalJobId: true },
  });
  const existingKeys = new Set(
    existingResponses.map((r) => `${r.candidateId}:${r.externalJobId}`)
  );
  console.log(`[Sync] Existing responses in DB: ${existingResponses.length}`);
  console.log("");

  let created = 0;
  let skippedExisting = 0;
  let skippedNoCandidate = 0;
  let errors = 0;

  for (const fb of feedbacks) {
    const candidateId = candidateMap.get(fb.job_seeker_id);
    if (!candidateId) {
      skippedNoCandidate++;
      continue;
    }

    const key = `${candidateId}:${fb.job_id}`;
    if (existingKeys.has(key)) {
      skippedExisting++;
      continue;
    }

    const validResponses = ["WANT_TO_APPLY", "INTERESTED"];
    if (!validResponses.includes(fb.response)) {
      console.warn(`[Sync] Invalid response "${fb.response}" for ${fb.job_seeker_id}:${fb.job_id}, skipping`);
      errors++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY] Would create: candidate=${fb.job_seeker_id}, job=${fb.job_id}, response=${fb.response}`);
    } else {
      try {
        await prisma.candidateJobResponse.create({
          data: {
            candidateId,
            externalJobId: fb.job_id,
            response: fb.response,
            respondedAt: fb.responded_at ? new Date(fb.responded_at) : new Date(),
          },
        });
      } catch (err) {
        console.error(`[Sync] Error creating response for ${fb.job_seeker_id}:${fb.job_id}:`, err);
        errors++;
        continue;
      }
    }
    created++;
  }

  console.log("");
  console.log("=== Result ===");
  console.log(`  Created:              ${created}${DRY_RUN ? " (dry run)" : ""}`);
  console.log(`  Skipped (existing):   ${skippedExisting}`);
  console.log(`  Skipped (no candidate): ${skippedNoCandidate}`);
  console.log(`  Errors:               ${errors}`);
  console.log(`  Total feedbacks:      ${feedbacks.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
