/**
 * T-064 Phase A: スカウト運用集計機能の初期マスタ投入
 *
 * 実行: npx tsx prisma/seed-scout-masters.ts
 *
 * 投入内容:
 *  - ScoutMachineMaster: 担当者→号機マスタ 8件
 *  - ScoutMediaMaster: 媒体マスタ 6件
 *  - ScoutSequence: スカウト番号カウンタ 1件（10062652 = FM最終想定 + 1000）
 *
 * 冪等: upsert 相当の挙動。複数回実行しても重複しない。
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const MACHINE_MASTERS = [
  { recruiterName: "藤本 なつみ", aliases: ["RPA 1号機", "RPA1号機", "RPA-1号機", "1号機"], machineNumber: 1, machineLabel: "1号機", isMachine: true, isActive: true },
  { recruiterName: "岡田 かなこ", aliases: ["RPA 2号機", "RPA2号機", "RPA-2号機", "2号機"], machineNumber: 2, machineLabel: "2号機", isMachine: true, isActive: true },
  { recruiterName: "上原 ちはる", aliases: ["RPA 3号機", "RPA3号機", "RPA-3号機", "3号機"], machineNumber: 3, machineLabel: "3号機", isMachine: true, isActive: true },
  { recruiterName: "上原 千遥", aliases: ["RPA 4号機", "RPA4号機", "RPA-4号機", "4号機"], machineNumber: 4, machineLabel: "4号機", isMachine: true, isActive: true },
  { recruiterName: "岡田 愛子", aliases: ["RPA 5号機", "RPA5号機", "RPA-5号機", "5号機"], machineNumber: 5, machineLabel: "5号機", isMachine: true, isActive: true },
  { recruiterName: "安藤 嘉富", aliases: ["RPA 6号機", "RPA6号機", "RPA-6号機", "6号機"], machineNumber: 6, machineLabel: "6号機", isMachine: true, isActive: false },
  { recruiterName: "大野 望", aliases: [], machineNumber: null, machineLabel: "人（社員）", isMachine: false, isActive: true },
  { recruiterName: "藤本 夏海", aliases: [], machineNumber: null, machineLabel: "人（社員）", isMachine: false, isActive: true },
];

const MEDIA_MASTERS = [
  { mediaName: "マイナビ転職", displayOrder: 1, isActive: true },
  { mediaName: "マイナビエージェント", displayOrder: 2, isActive: true },
  { mediaName: "indeed", displayOrder: 3, isActive: false },
  { mediaName: "日経HR", displayOrder: 4, isActive: false },
  { mediaName: "自社HP", displayOrder: 5, isActive: false },
  { mediaName: "dodaMaps", displayOrder: 6, isActive: false },
];

// FM最終番号は SC10061652 前後と推定（将幸さん指示）
// 安全マージン +1000、次回採番は +1001 から
const SCOUT_SEQUENCE_INITIAL = 10062652;

async function main() {
  console.log("[seed-scout-masters] 開始");

  // ScoutMachineMaster
  for (const m of MACHINE_MASTERS) {
    const existing = await prisma.scoutMachineMaster.findFirst({
      where: { recruiterName: m.recruiterName },
    });
    if (existing) {
      await prisma.scoutMachineMaster.update({
        where: { id: existing.id },
        data: {
          aliases: m.aliases,
          machineNumber: m.machineNumber,
          machineLabel: m.machineLabel,
          isMachine: m.isMachine,
          isActive: m.isActive,
        },
      });
      console.log(`  [更新] 担当者: ${m.recruiterName}`);
    } else {
      await prisma.scoutMachineMaster.create({
        data: m,
      });
      console.log(`  [新規] 担当者: ${m.recruiterName}`);
    }
  }

  // ScoutMediaMaster
  for (const m of MEDIA_MASTERS) {
    await prisma.scoutMediaMaster.upsert({
      where: { mediaName: m.mediaName },
      update: { displayOrder: m.displayOrder, isActive: m.isActive },
      create: m,
    });
    console.log(`  [媒体] ${m.mediaName}`);
  }

  // ScoutSequence
  const existingSeq = await prisma.scoutSequence.findFirst();
  if (!existingSeq) {
    await prisma.scoutSequence.create({
      data: { lastNumber: SCOUT_SEQUENCE_INITIAL },
    });
    console.log(`  [採番カウンタ] 初期値: ${SCOUT_SEQUENCE_INITIAL}`);
  } else {
    console.log(`  [採番カウンタ] 既存: ${existingSeq.lastNumber} (変更しない)`);
  }

  console.log("[seed-scout-masters] 完了");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
