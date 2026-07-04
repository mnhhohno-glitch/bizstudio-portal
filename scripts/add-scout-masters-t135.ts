/**
 * T-135 step6 / Task 2: ScoutMachineMaster への新規配信者5名の追加
 *
 * 背景:
 *   FM 全量入替（replace-slots-from-fm-t135.ts）で FM の社員NO(BS#)を配信枠の machineId に
 *   解決する必要がある。以下5名は既存マスタに存在しないため事前追加する。
 *   既存の同名レコード（RPA号機）とは「別レコード」として追加し、既存行は一切変更しない。
 *
 * 追加対象（確定値・推測禁止）:
 *   BS1000001 大野 将幸            isMachine=false（人・社員）
 *   BS1000002 小野 有加            isMachine=false
 *   BS1000005 上原 千遥（本人）    isMachine=false （既存「上原 千遥」=RPA4号機とは別）
 *   BS1000007 岡田 愛子（本人）    isMachine=false （既存「岡田 愛子」=RPA5号機とは別）
 *   BS1000016 岡田 愛子(bizstudio) isMachine=true・machineNumber=null
 *
 * recruiterName に（本人）/(bizstudio) の識別子を付けることで、既存の RPA号機（"上原 千遥" /
 * "岡田 愛子"）と名前衝突しない → FM import は recruiterName で一意に machineId を引ける。
 *
 * 日次生成（create-daily-slots → slot-helpers.createDailySlots）は ScoutMachineMaster を
 * where 無しの findMany で全件取得するため、isActive/isMachine に関わらず追加行も翌日以降の
 * 日次枠生成に自動的に乗る。isAggregationTarget は isMachine ? isActive : false で決まる。
 *   → 岡田愛子(bizstudio): isMachine=true・isActive=true → 集計対象 true で日次枠が作られる。
 *   → 本人4名: isMachine=false → 既存「人（社員）」（大野望・藤本夏海）と同じ扱い（集計対象 false）。
 *
 * 冪等: recruiterName 一致の既存レコードがあればスキップ。--dry-run（既定）/ --execute。
 *
 * 実行:
 *   npx tsx scripts/add-scout-masters-t135.ts            # DRY-RUN
 *   npx tsx scripts/add-scout-masters-t135.ts --execute  # 本実行（共有prod DB）
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const EXECUTE = process.argv.includes("--execute");
const MODE = EXECUTE ? "EXECUTE" : "DRY-RUN";

type NewMaster = {
  employeeNo: string; // FM 社員NO（記録用・参照のみ）
  recruiterName: string;
  isMachine: boolean;
  machineNumber: number | null;
  machineLabel: string;
};

const NEW_MASTERS: NewMaster[] = [
  { employeeNo: "BS1000001", recruiterName: "大野 将幸", isMachine: false, machineNumber: null, machineLabel: "人（社員）" },
  { employeeNo: "BS1000002", recruiterName: "小野 有加", isMachine: false, machineNumber: null, machineLabel: "人（社員）" },
  { employeeNo: "BS1000005", recruiterName: "上原 千遥（本人）", isMachine: false, machineNumber: null, machineLabel: "人（社員）" },
  { employeeNo: "BS1000007", recruiterName: "岡田 愛子（本人）", isMachine: false, machineNumber: null, machineLabel: "人（社員）" },
  { employeeNo: "BS1000016", recruiterName: "岡田 愛子(bizstudio)", isMachine: true, machineNumber: null, machineLabel: "岡田 愛子(bizstudio)" },
];

async function main() {
  console.log(`=== T-135 step6 Task2: ScoutMachineMaster 追加 (mode=${MODE}) ===\n`);

  const existing = await prisma.scoutMachineMaster.findMany({
    select: { id: true, recruiterName: true, isMachine: true, machineNumber: true, isActive: true },
  });
  const byName = new Map(existing.map((m) => [m.recruiterName, m]));

  console.log(`既存マスタ: ${existing.length}件`);
  for (const m of existing) {
    console.log(`  - ${m.recruiterName} (isMachine=${m.isMachine}, machineNumber=${m.machineNumber ?? "null"}, isActive=${m.isActive})`);
  }
  console.log("");

  type Plan = { m: NewMaster; action: "CREATE" | "SKIP_EXISTS"; existingId?: string };
  const plans: Plan[] = NEW_MASTERS.map((m) => {
    const hit = byName.get(m.recruiterName);
    return hit ? { m, action: "SKIP_EXISTS", existingId: hit.id } : { m, action: "CREATE" };
  });

  console.log("=== 追加計画 ===");
  for (const p of plans) {
    if (p.action === "SKIP_EXISTS") {
      console.log(`  ○ ${p.m.employeeNo} ${p.m.recruiterName} → 既存あり(id=${p.existingId}) スキップ`);
    } else {
      console.log(`  + ${p.m.employeeNo} ${p.m.recruiterName} isMachine=${p.m.isMachine} machineNumber=${p.m.machineNumber ?? "null"} label="${p.m.machineLabel}"`);
    }
  }

  if (!EXECUTE) {
    console.log(`\n(DRY-RUN: 未実行。--execute で本実行)`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  console.log(`\n=== EXECUTE ===`);
  const createdIds: Record<string, string> = {};
  let created = 0;
  let skipped = 0;
  for (const p of plans) {
    if (p.action === "SKIP_EXISTS") {
      skipped++;
      createdIds[p.m.employeeNo] = p.existingId!;
      continue;
    }
    const row = await prisma.scoutMachineMaster.create({
      data: {
        recruiterName: p.m.recruiterName,
        aliases: [],
        machineNumber: p.m.machineNumber,
        machineLabel: p.m.machineLabel,
        isMachine: p.m.isMachine,
        isActive: true,
      },
      select: { id: true },
    });
    createdIds[p.m.employeeNo] = row.id;
    created++;
    console.log(`  ✓ ${p.m.employeeNo} ${p.m.recruiterName} → id=${row.id}`);
  }
  console.log(`\n作成=${created} / スキップ(既存)=${skipped}`);
  console.log(`\n社員NO→masterId 対応（Task3 参照用）:`);
  console.log(JSON.stringify(createdIds, null, 2));

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(1);
});
