/**
 * T-064: 配信レコード一覧 API のロジック疎通確認
 *
 * 実行: npx tsx scripts/test-scout-slots-list.ts
 *
 * 直接 Prisma + 計算ロジックの再現で検証（API 経由ではなくロジックのみ）
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
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

function ageAtDate(birthday: Date, at: Date): number {
  let age = at.getFullYear() - birthday.getFullYear();
  const m = at.getMonth() - birthday.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < birthday.getDate())) age--;
  return age;
}

function dayOfWeekJa(date: Date): string {
  return ["日", "月", "火", "水", "木", "金", "土"][date.getUTCDay()];
}

function timeBlock(hour: number): string {
  if (hour < 12) return "午前";
  if (hour < 14) return "昼";
  if (hour < 17) return "午後";
  return "夕方";
}

async function main() {
  console.log("\n=== T-064 レコード一覧ロジック 疎通確認 ===\n");

  const staff = await prisma.scoutMachineMaster.findFirst({
    where: { isMachine: false, isActive: true },
  });
  if (!staff) {
    console.log("社員枠が見つかりません");
    process.exit(1);
  }

  const baseDate = new Date();
  baseDate.setUTCDate(baseDate.getUTCDate() - 130);
  const dateStr = baseDate.toISOString().slice(0, 10);
  const dateUtc = parseSlotDate(dateStr);

  // クリーンアップ
  await prisma.scoutDeliverySlot.deleteMany({
    where: { deliveryDate: dateUtc, machineId: staff.id },
  });

  const createdCandidates: string[] = [];

  // テスト用スロットを作る（deliveryCount=100, openCount=40, 紐付け候補4人）
  const seq = await generateScoutNumber();
  const slot = await prisma.scoutDeliverySlot.create({
    data: {
      scoutNumber: seq,
      deliveryDate: dateUtc,
      hourSlot: 14,
      machineId: staff.id,
      isMachine: false,
      isStaff: true,
      deliveryCategoryLarge: "社員",
      deliveryCategoryMedium: "一斉配信",
      deliveryCategorySmall: "検索条件指定",
      mediaSource: "マイナビ転職",
      searchConditionName: "LISTTEST-1",
      deliveryCount: 100,
      openCount: 40,
      isAggregationTarget: true,
    },
  });

  async function makeCandidate(birthYear: number, applicationDate: Date) {
    const num = `T064LIST${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const c = await prisma.candidate.create({
      data: {
        candidateNumber: num,
        name: "テスト応募者",
        applicationRoute: "スカウト",
        mediaSource: "マイナビ転職",
        birthday: new Date(Date.UTC(birthYear, 5, 15)),
        createdAt: applicationDate,
        scoutDeliverySlotId: slot.id,
        scoutNumber: slot.scoutNumber,
        scoutLinkedAt: applicationDate,
      },
    });
    createdCandidates.push(c.id);
    return c;
  }

  // 応募日 = baseDate
  // 各 birthYear で年齢算出: at = baseDate.year - birthYear
  const at = baseDate;
  const atYear = at.getFullYear();
  // 28歳 → 20s, 35歳 → 30s, 35歳 → 30s, 47歳 → 40s
  await makeCandidate(atYear - 28, at);
  await makeCandidate(atYear - 35, at);
  await makeCandidate(atYear - 35, at);
  await makeCandidate(atYear - 47, at);

  // 年代カウントロジック検証
  const slotWithCands = await prisma.scoutDeliverySlot.findUnique({
    where: { id: slot.id },
    include: { linkedCandidates: { select: { id: true, birthday: true, createdAt: true } } },
  });
  const ageGroups = { "20s": 0, "30s": 0, "40s": 0, "50s": 0 };
  for (const c of slotWithCands!.linkedCandidates) {
    if (!c.birthday) continue;
    const age = ageAtDate(c.birthday, c.createdAt);
    if (age >= 20 && age < 30) ageGroups["20s"]++;
    else if (age >= 30 && age < 40) ageGroups["30s"]++;
    else if (age >= 40 && age < 50) ageGroups["40s"]++;
    else if (age >= 50 && age < 60) ageGroups["50s"]++;
  }

  check("20代カウント=1", ageGroups["20s"] === 1, String(ageGroups["20s"]));
  check("30代カウント=2", ageGroups["30s"] === 2, String(ageGroups["30s"]));
  check("40代カウント=1", ageGroups["40s"] === 1, String(ageGroups["40s"]));
  check("50代カウント=0", ageGroups["50s"] === 0, String(ageGroups["50s"]));

  // 応募率検証
  const applyCount = slotWithCands!.linkedCandidates.length;
  const openRate = (slot.openCount / slot.deliveryCount) * 100;
  const applyRate1 = (applyCount / slot.deliveryCount) * 100;
  const applyRate2 = (applyCount / slot.openCount) * 100;

  check("応募数=4", applyCount === 4);
  check("開封率=40.0%", Math.abs(openRate - 40.0) < 0.01, `${openRate}%`);
  check("応募率①=4.0% (4/100)", Math.abs(applyRate1 - 4.0) < 0.01, `${applyRate1}%`);
  check("応募率②=10.0% (4/40)", Math.abs(applyRate2 - 10.0) < 0.01, `${applyRate2}%`);

  // 曜日 / 時間帯
  check("曜日が日本語1文字", /^[日月火水木金土]$/.test(dayOfWeekJa(dateUtc)));
  check("時間帯14時=午後", timeBlock(14) === "午後");
  check("時間帯10時=午前", timeBlock(10) === "午前");
  check("時間帯12時=昼", timeBlock(12) === "昼");
  check("時間帯18時=夕方", timeBlock(18) === "夕方");

  // クリーンアップ
  await prisma.candidate.deleteMany({ where: { id: { in: createdCandidates } } });
  await prisma.scoutDeliverySlot.deleteMany({
    where: { deliveryDate: dateUtc, machineId: staff.id },
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
