/**
 * T-064: 過去応募者 自動紐付けバッチの統合テスト
 *
 * 実行: npx tsx scripts/test-backfill-scout-link.ts
 *
 * 確認:
 *  1. 対象 Candidate 群を作成
 *  2. backfill 相当ロジック（autoLinkCandidateToSlot を全件適用）を実行
 *  3. 紐付け成功 / no_machine_master / no_recruiter_name の各件数が想定通り
 *  4. テストデータ削除
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { autoLinkCandidateToSlot, findMatchingSlot } from "../src/lib/scout/auto-link";
import { generateScoutNumber } from "../src/lib/scout/scout-number";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("\n=== T-064 backfill バッチ 統合テスト ===\n");

  const staff = await prisma.scoutMachineMaster.findFirst({
    where: { isMachine: false, isActive: true },
  });
  if (!staff) {
    console.log("社員枠が見つかりません");
    process.exit(1);
  }
  console.log(`[setup] 担当者: ${staff.recruiterName}`);

  // ベース日付: 過去 -160 日 (UTC 03:00 = JST 12:00 で JST/UTC の日付ズレを排除)
  const now = new Date();
  const baseUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  baseUtcMidnight.setUTCDate(baseUtcMidnight.getUTCDate() - 160);
  const baseDate = new Date(baseUtcMidnight.getTime() + 3 * 60 * 60 * 1000);

  // 既存スロット / Candidate を念のため削除
  const existingSlots = await prisma.scoutDeliverySlot.findMany({
    where: { deliveryDate: baseUtcMidnight, machineId: staff.id },
    select: { id: true },
  });
  if (existingSlots.length > 0) {
    await prisma.candidate.deleteMany({
      where: { scoutDeliverySlotId: { in: existingSlots.map((s) => s.id) } },
    });
    await prisma.scoutDeliverySlot.deleteMany({
      where: { id: { in: existingSlots.map((s) => s.id) } },
    });
  }

  // テスト用スロット作成 (deliveryCount=50)
  const seq = await generateScoutNumber();
  const slot = await prisma.scoutDeliverySlot.create({
    data: {
      scoutNumber: seq,
      deliveryDate: baseUtcMidnight,
      hourSlot: 14,
      machineId: staff.id,
      isMachine: false,
      isStaff: true,
      deliveryCategoryLarge: "社員",
      deliveryCategoryMedium: "一斉配信",
      deliveryCategorySmall: "検索条件指定",
      mediaSource: "マイナビ転職",
      searchConditionName: "BACKFILL-TEST",
      deliveryCount: 50,
      openCount: 20,
      isAggregationTarget: true,
    },
  });

  // Candidate 群作成 (全て scoutDeliverySlotId=null, applicationRoute=スカウト)
  const createdCandidateIds: string[] = [];

  async function makeCandidate(opts: { name: string; recruiterName: string | null }) {
    const num = `BACKFILL_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const c = await prisma.candidate.create({
      data: {
        candidateNumber: num,
        name: opts.name,
        applicationRoute: "スカウト",
        mediaSource: "マイナビ転職",
        recruiterName: opts.recruiterName,
        createdAt: baseDate,
        // scoutDeliverySlotId は null のまま（未紐付け状態）
      },
    });
    createdCandidateIds.push(c.id);
    return c;
  }

  // パターン:
  // A) 担当者一致 → matched
  await makeCandidate({ name: "テスト 田中", recruiterName: staff.recruiterName });
  await makeCandidate({ name: "テスト 山田", recruiterName: staff.recruiterName });
  // B) 担当者マスタ未マッチ → no_machine_master
  await makeCandidate({ name: "テスト 鈴木", recruiterName: "存在しない担当者XYZ" });
  // C) recruiterName 空 → no_recruiter_name
  await makeCandidate({ name: "テスト 高橋", recruiterName: null });
  await makeCandidate({ name: "テスト 渡辺", recruiterName: "" });

  // backfill 相当ロジック（autoLinkCandidateToSlot を全件適用）
  const targets = await prisma.candidate.findMany({
    where: {
      id: { in: createdCandidateIds },
      applicationRoute: "スカウト",
      scoutDeliverySlotId: null,
    },
    select: { id: true, recruiterName: true, createdAt: true },
  });

  check("対象 Candidate=5件", targets.length === 5, String(targets.length));

  const counts = {
    matched: 0,
    no_machine_master: 0,
    no_recruiter_name: 0,
    no_candidate_today: 0,
    no_candidate_yesterday: 0,
    error: 0,
  };

  for (const c of targets) {
    const r = await autoLinkCandidateToSlot({
      candidateId: c.id,
      recruiterName: c.recruiterName,
      applicationDate: c.createdAt,
    });
    counts[r.reason]++;
  }

  check("matched=2 (担当者一致)", counts.matched === 2, String(counts.matched));
  check("no_machine_master=1 (XYZ)", counts.no_machine_master === 1, String(counts.no_machine_master));
  check("no_recruiter_name=2 (null + 空文字)", counts.no_recruiter_name === 2, String(counts.no_recruiter_name));

  // 紐付け後の DB 反映確認
  const linkedNow = await prisma.candidate.findMany({
    where: { id: { in: createdCandidateIds }, scoutDeliverySlotId: { not: null } },
    select: { id: true, scoutDeliverySlotId: true, scoutNumber: true, scoutLinkedAt: true, scoutLinkedById: true },
  });
  check("紐付け済 Candidate=2件", linkedNow.length === 2, String(linkedNow.length));
  check("全件 scoutDeliverySlotId=slot.id", linkedNow.every((c) => c.scoutDeliverySlotId === slot.id));
  check("全件 scoutNumber=slot.scoutNumber", linkedNow.every((c) => c.scoutNumber === slot.scoutNumber));
  check("全件 scoutLinkedById=null（バッチ）", linkedNow.every((c) => c.scoutLinkedById === null));
  check("全件 scoutLinkedAt が設定済", linkedNow.every((c) => c.scoutLinkedAt !== null));

  // 冪等性: 同じ Candidate に再度 autoLink を呼んでも壊れない
  // （既に scoutDeliverySlotId が入っているので backfill 対象から外れる）
  const remainingTargets = await prisma.candidate.findMany({
    where: {
      id: { in: createdCandidateIds },
      applicationRoute: "スカウト",
      scoutDeliverySlotId: null,
    },
    select: { id: true },
  });
  check("再実行時の対象は3件のみ（紐付け済2件は除外）", remainingTargets.length === 3, String(remainingTargets.length));

  // DRY RUN ロジック（findMatchingSlot のみ呼ぶ）の挙動確認
  // 担当者一致 Candidate を念のため再作成（既存の2件は紐付け済なので別途）
  const dryC = await makeCandidate({ name: "DRY 太郎", recruiterName: staff.recruiterName });
  const dryMatch = await findMatchingSlot({
    recruiterName: dryC.recruiterName!,
    applicationDate: dryC.createdAt,
  });
  check("findMatchingSlot がスロットを返す", dryMatch !== null);
  // DRY RUN は DB 書き込みなしであることを確認
  const dryCRefetch = await prisma.candidate.findUnique({
    where: { id: dryC.id },
    select: { scoutDeliverySlotId: true },
  });
  check("DRY RUN 相当呼び出し後も scoutDeliverySlotId=null", dryCRefetch?.scoutDeliverySlotId === null);

  // クリーンアップ
  await prisma.candidate.deleteMany({ where: { id: { in: createdCandidateIds } } });
  await prisma.scoutDeliverySlot.delete({ where: { id: slot.id } });

  console.log(`\n=== 結果: ${pass} PASS / ${fail} FAIL ===\n`);
  process.exit(fail > 0 ? 1 : 0);
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
