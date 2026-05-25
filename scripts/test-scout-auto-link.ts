/**
 * T-064: PDF取り込み時の自動紐付け疎通確認
 *
 * 実行: npx tsx scripts/test-scout-auto-link.ts
 *
 * 確認:
 *  1. recruiterName が ScoutMachineMaster にあり、同日に1件のスロットがある場合 → 紐付け成功
 *  2. 同日に複数（個別配信＋一斉配信）あり deliveryCount>0 の方が優先される
 *  3. 同日になく前日にある場合 → 前日のスロットに紐付け
 *  4. recruiterName が ScoutMachineMaster にない → no_machine_master
 *  5. recruiterName が空 → no_recruiter_name
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { autoLinkCandidateToSlot, findMatchingSlot } from "../src/lib/scout/auto-link";
import { parseSlotDate } from "../src/lib/scout/slot-helpers";
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
  console.log("\n=== T-064 自動紐付け 疎通確認 ===\n");

  const staff = await prisma.scoutMachineMaster.findFirst({
    where: { isMachine: false, isActive: true },
  });
  if (!staff) {
    console.log("社員枠が見つかりません");
    process.exit(1);
  }
  console.log(`[setup] 対象担当者: ${staff.recruiterName}`);

  // 過去 -120 日。autoLink は applicationDate を JST 解釈するので、
  // baseDate を「JST 正午」に固定して JST/UTC 日付ズレを排除する。
  // JST 正午 = UTC 03:00
  const now = new Date();
  const baseUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  baseUtcMidnight.setUTCDate(baseUtcMidnight.getUTCDate() - 120);
  const baseDate = new Date(baseUtcMidnight.getTime() + 3 * 60 * 60 * 1000); // UTC 03:00 = JST 12:00
  // JST 日付（その日）
  const dateStr = baseUtcMidnight.toISOString().slice(0, 10);
  const yesterdayUtcMidnight = new Date(baseUtcMidnight);
  yesterdayUtcMidnight.setUTCDate(yesterdayUtcMidnight.getUTCDate() - 1);
  const yesterdayStr = yesterdayUtcMidnight.toISOString().slice(0, 10);
  const dateUtc = parseSlotDate(dateStr);
  const yesterdayUtc = parseSlotDate(yesterdayStr);
  console.log(`[setup] target JST date: ${dateStr} (yesterday: ${yesterdayStr})`);

  // クリーンアップ
  await prisma.scoutDeliverySlot.deleteMany({
    where: {
      deliveryDate: { in: [dateUtc, yesterdayUtc] },
      machineId: staff.id,
    },
  });

  // テスト用 Candidate を作る（テスト後に削除）
  const createdCandidates: string[] = [];

  async function createCandidate(opts: { recruiterName?: string | null; createdAt: Date }) {
    const num = `T064AL${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const c = await prisma.candidate.create({
      data: {
        candidateNumber: num,
        name: "テスト 自動紐付け",
        applicationRoute: "スカウト",
        mediaSource: "マイナビ転職",
        ...(opts.recruiterName ? { recruiterName: opts.recruiterName } : {}),
        createdAt: opts.createdAt,
      },
    });
    createdCandidates.push(c.id);
    return c;
  }

  // ---- Case 1: 当日に1件のスロットがあり、紐付け成功 ----
  console.log("\n[1] 当日に1件 → 紐付け成功");
  const seq1 = await generateScoutNumber();
  const single = await prisma.scoutDeliverySlot.create({
    data: {
      scoutNumber: seq1,
      deliveryDate: dateUtc,
      hourSlot: 14,
      machineId: staff.id,
      isMachine: false,
      isStaff: true,
      deliveryCategoryLarge: "社員",
      deliveryCategoryMedium: "一斉配信",
      deliveryCategorySmall: "検索条件指定",
      searchConditionName: "AUTOLINK-CASE1",
      mediaSource: "マイナビ転職",
      deliveryCount: 30,
      isAggregationTarget: true,
    },
  });
  const cand1 = await createCandidate({ recruiterName: staff.recruiterName, createdAt: baseDate });
  const res1 = await autoLinkCandidateToSlot({
    candidateId: cand1.id,
    recruiterName: staff.recruiterName,
    applicationDate: baseDate,
  });
  check("linked=true", res1.linked === true);
  check("reason=matched", res1.reason === "matched");
  check("正しい slotId", res1.slotId === single.id);
  check("正しい scoutNumber", res1.scoutNumber === seq1);
  const cand1After = await prisma.candidate.findUnique({ where: { id: cand1.id } });
  check("Candidate.scoutDeliverySlotId が設定済", cand1After?.scoutDeliverySlotId === single.id);
  check("Candidate.scoutNumber が設定済", cand1After?.scoutNumber === seq1);
  check("Candidate.scoutLinkedAt が設定済", !!cand1After?.scoutLinkedAt);

  // Case 1 後片付け（cand1 を解除して再利用しない、スロットも消す）
  await prisma.candidate.update({
    where: { id: cand1.id },
    data: { scoutDeliverySlotId: null, scoutNumber: null, scoutLinkedAt: null },
  });
  await prisma.scoutDeliverySlot.delete({ where: { id: single.id } });

  // ---- Case 2: 個別配信+一斉配信が同日にあり、deliveryCount > 0 が優先 ----
  console.log("\n[2] 当日に複数（deliveryCount>0 優先）");
  const seqA = await generateScoutNumber();
  const slotEmpty = await prisma.scoutDeliverySlot.create({
    data: {
      scoutNumber: seqA,
      deliveryDate: dateUtc,
      hourSlot: 10,
      machineId: staff.id,
      isMachine: false,
      isStaff: true,
      deliveryCategoryLarge: "社員",
      deliveryCategoryMedium: "個別配信",
      deliveryCategorySmall: "検索条件指定",
      mediaSource: "マイナビ転職",
      deliveryCount: 0,
      isAggregationTarget: true,
    },
  });
  const seqB = await generateScoutNumber();
  const slotHasDelivery = await prisma.scoutDeliverySlot.create({
    data: {
      scoutNumber: seqB,
      deliveryDate: dateUtc,
      hourSlot: 14,
      machineId: staff.id,
      isMachine: false,
      isStaff: true,
      deliveryCategoryLarge: "社員",
      deliveryCategoryMedium: "一斉配信",
      deliveryCategorySmall: "検索条件指定",
      mediaSource: "マイナビ転職",
      deliveryCount: 50,
      isAggregationTarget: true,
    },
  });
  const matched = await findMatchingSlot({
    recruiterName: staff.recruiterName,
    applicationDate: baseDate,
  });
  check(
    "deliveryCount>0 のスロットが選ばれる",
    matched?.slotId === slotHasDelivery.id,
    matched?.scoutNumber,
  );

  await prisma.scoutDeliverySlot.delete({ where: { id: slotEmpty.id } });
  await prisma.scoutDeliverySlot.delete({ where: { id: slotHasDelivery.id } });

  // ---- Case 3: 当日になく前日のみ ----
  console.log("\n[3] 当日にスロットなし → 前日にフォールバック");
  const seqY = await generateScoutNumber();
  const yesterdaySlot = await prisma.scoutDeliverySlot.create({
    data: {
      scoutNumber: seqY,
      deliveryDate: yesterdayUtc,
      hourSlot: 11,
      machineId: staff.id,
      isMachine: false,
      isStaff: true,
      deliveryCategoryLarge: "社員",
      deliveryCategoryMedium: "一斉配信",
      deliveryCategorySmall: "検索条件指定",
      mediaSource: "マイナビ転職",
      deliveryCount: 20,
      isAggregationTarget: true,
    },
  });
  const cand3 = await createCandidate({ recruiterName: staff.recruiterName, createdAt: baseDate });
  const res3 = await autoLinkCandidateToSlot({
    candidateId: cand3.id,
    recruiterName: staff.recruiterName,
    applicationDate: baseDate,
  });
  check("linked=true（前日にフォールバック）", res3.linked === true);
  check("正しい前日 slotId", res3.slotId === yesterdaySlot.id);
  check("reason=matched", res3.reason === "matched");

  await prisma.candidate.update({
    where: { id: cand3.id },
    data: { scoutDeliverySlotId: null, scoutNumber: null, scoutLinkedAt: null },
  });
  await prisma.scoutDeliverySlot.delete({ where: { id: yesterdaySlot.id } });

  // ---- Case 4: recruiterName が ScoutMachineMaster にない ----
  console.log("\n[4] recruiterName が ScoutMachineMaster にない");
  const cand4 = await createCandidate({
    recruiterName: "存在しない 担当者xyz_T064",
    createdAt: baseDate,
  });
  const res4 = await autoLinkCandidateToSlot({
    candidateId: cand4.id,
    recruiterName: "存在しない 担当者xyz_T064",
    applicationDate: baseDate,
  });
  check("linked=false", res4.linked === false);
  check("reason=no_machine_master", res4.reason === "no_machine_master");

  // ---- Case 5: recruiterName が null ----
  console.log("\n[5] recruiterName が null");
  const cand5 = await createCandidate({ recruiterName: null, createdAt: baseDate });
  const res5 = await autoLinkCandidateToSlot({
    candidateId: cand5.id,
    recruiterName: null,
    applicationDate: baseDate,
  });
  check("linked=false", res5.linked === false);
  check("reason=no_recruiter_name", res5.reason === "no_recruiter_name");

  // ---- Case 6: 当日も前日もスロットなし ----
  console.log("\n[6] 当日も前日もスロットなし");
  const cand6 = await createCandidate({ recruiterName: staff.recruiterName, createdAt: baseDate });
  const res6 = await autoLinkCandidateToSlot({
    candidateId: cand6.id,
    recruiterName: staff.recruiterName,
    applicationDate: baseDate,
  });
  check("linked=false", res6.linked === false);
  check("reason=no_candidate_yesterday", res6.reason === "no_candidate_yesterday");

  // ---- Case 7: エイリアス・スペース揺れマッチ ----
  console.log("\n[7] エイリアス・スペース揺れマッチ");
  // 当日にスロットを1件作成（社員枠 = staff）
  const seq7 = await generateScoutNumber();
  const slot7 = await prisma.scoutDeliverySlot.create({
    data: {
      scoutNumber: seq7,
      deliveryDate: dateUtc,
      hourSlot: 14,
      machineId: staff.id,
      isMachine: false,
      isStaff: true,
      deliveryCategoryLarge: "社員",
      deliveryCategoryMedium: "一斉配信",
      deliveryCategorySmall: "検索条件指定",
      mediaSource: "マイナビ転職",
      deliveryCount: 30,
      isAggregationTarget: true,
    },
  });

  // 7-a: スペース無し
  const nameNoSpace = staff.recruiterName.replace(/[\s　]+/g, "");
  const matchNoSpace = await findMatchingSlot({
    recruiterName: nameNoSpace,
    applicationDate: baseDate,
  });
  check(`スペース無し "${nameNoSpace}" でマッチ`, matchNoSpace?.slotId === slot7.id);

  // 7-b: 全角スペース
  const nameFullSpace = staff.recruiterName.replace(/[\s　]+/g, "　");
  const matchFullSpace = await findMatchingSlot({
    recruiterName: nameFullSpace,
    applicationDate: baseDate,
  });
  check(`全角スペース "${nameFullSpace}" でマッチ`, matchFullSpace?.slotId === slot7.id);

  // 7-c: 半角スペース（既存）
  const matchHalfSpace = await findMatchingSlot({
    recruiterName: staff.recruiterName,
    applicationDate: baseDate,
  });
  check(`半角スペース "${staff.recruiterName}" でマッチ`, matchHalfSpace?.slotId === slot7.id);

  // 7-d: 完全に無関係な名前はマッチしない
  const matchNone = await findMatchingSlot({
    recruiterName: "存在しないXYZ太郎",
    applicationDate: baseDate,
  });
  check("無効な名前はマッチしない", matchNone === null);

  // 7-e: RPA号機エイリアス（マスタに aliases=['RPA 1号機'] が登録されていれば 1号機担当者にマッチ）
  // 1号機マスタの存在確認（テスト環境でマスタが投入済の前提）
  const rpa1 = await prisma.scoutMachineMaster.findFirst({
    where: { machineLabel: "1号機" },
  });
  if (rpa1) {
    // 念のため既存 RPA1 のスロットを削除（過去テスト残りなど）
    await prisma.scoutDeliverySlot.deleteMany({
      where: { deliveryDate: dateUtc, machineId: rpa1.id },
    });
    // 1号機担当者の slot を当日に作成
    const seqRpa = await generateScoutNumber();
    const slotRpa = await prisma.scoutDeliverySlot.create({
      data: {
        scoutNumber: seqRpa,
        deliveryDate: dateUtc,
        hourSlot: 9,
        machineId: rpa1.id,
        isMachine: true,
        isStaff: false,
        deliveryCategoryLarge: "RPA",
        deliveryCategoryMedium: "一斉配信",
        deliveryCategorySmall: "検索条件指定",
        mediaSource: "マイナビ転職",
        deliveryCount: 50,
        isAggregationTarget: true,
      },
    });
    const matchAlias1 = await findMatchingSlot({
      recruiterName: "RPA 1号機",
      applicationDate: baseDate,
    });
    check(`"RPA 1号機" がエイリアスで 1号機担当者にマッチ`, matchAlias1?.slotId === slotRpa.id);

    const matchAlias2 = await findMatchingSlot({
      recruiterName: "RPA1号機",
      applicationDate: baseDate,
    });
    check(`"RPA1号機"（スペース無し）でも 1号機担当者にマッチ`, matchAlias2?.slotId === slotRpa.id);

    await prisma.scoutDeliverySlot.delete({ where: { id: slotRpa.id } });
  } else {
    console.log("  (1号機マスタが未登録のため alias テストはスキップ)");
  }

  await prisma.scoutDeliverySlot.delete({ where: { id: slot7.id } });

  // クリーンアップ
  await prisma.candidate.deleteMany({ where: { id: { in: createdCandidates } } });
  await prisma.scoutDeliverySlot.deleteMany({
    where: {
      deliveryDate: { in: [dateUtc, yesterdayUtc] },
      machineId: staff.id,
    },
  });

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
