/**
 * T-190 Step2 ②: 「配信日は直っているのに枠が応募日のまま」の紐づけ張り替えスクリプト
 *
 * 背景:
 *   スカウト集計 API（/api/scout/stats・/api/scout/candidates・/api/scout/slots/list）は
 *   ScoutDeliverySlot.deliveryDate と slot.linkedCandidates しか読まない。
 *   Candidate.scoutDeliveryDate は集計から一切参照されないため、配信日を直しても
 *   紐づき枠が応募日の枠のまま残っていると数字が動かない（= 144 件）。
 *
 * 対象:
 *   applicationRoute = "スカウト"
 *   かつ scoutDeliverySlotId IS NOT NULL
 *   かつ scoutDeliveryDate  IS NOT NULL
 *   かつ scoutLinkedById    IS NULL          （人が手で紐づけた行は触らない）
 *   かつ JST暦日(紐づき枠.deliveryDate) ≠ JST暦日(scoutDeliveryDate)
 *
 * 処理:
 *   現在の紐づき枠と同一 machineId（同一配信者）の、scoutDeliveryDate の日の枠を
 *   pickBestSlot（auto-link と同じ枠選択ロジック）で選び、scoutDeliverySlotId /
 *   scoutNumber のみを付け替える。
 *   - 該当枠が無ければ「移動不可」として現状維持。**前日フォールバックはしない**
 *   - scoutDeliveryDate / masType / applicationDate は絶対に触らない
 *
 * 実行:
 *   npx tsx --env-file=.env scripts/relink-scout-slots-t190.ts            # dry-run（既定）
 *   npx tsx --env-file=.env scripts/relink-scout-slots-t190.ts --execute  # 本番DB更新
 *
 * idempotent: 移動後は「同日」になり対象から外れるため、再実行すると対象 0 件になる。
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { pickBestSlot, toJstDateOnly } from "../src/lib/scout/auto-link";

/** JST 暦日 YYYY-MM-DD（罠#17: toISOString().slice(0,10) は使わない） */
function jstYmd(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

export type RelinkPlan = {
  candidateId: string;
  candidateNumber: string;
  name: string;
  machineLabel: string;
  /** 張り替え前の枠の JST 暦日 */
  fromDay: string;
  /** ポータルの配信日（= 移動したい日）の JST 暦日 */
  targetDay: string;
  /** 移動先枠（移動不可なら null） */
  toSlotId: string | null;
  toScoutNumber: string | null;
  /** 移動不可の理由（移動可なら null） */
  blockedReason: string | null;
};

/** 対象を洗い出して移動計画を作る（読み取りのみ）。③のリスト出力からも使う。 */
export async function buildRelinkPlans(): Promise<RelinkPlan[]> {
  const rows = await prisma.candidate.findMany({
    where: {
      applicationRoute: "スカウト",
      scoutDeliverySlotId: { not: null },
      scoutDeliveryDate: { not: null },
      scoutLinkedById: null,
    },
    select: {
      id: true,
      candidateNumber: true,
      name: true,
      scoutDeliveryDate: true,
      scoutDeliverySlot: {
        select: {
          id: true,
          deliveryDate: true,
          machineId: true,
          machine: { select: { machineLabel: true, recruiterName: true } },
        },
      },
    },
    orderBy: { candidateNumber: "asc" },
  });

  const plans: RelinkPlan[] = [];
  for (const c of rows) {
    const slot = c.scoutDeliverySlot;
    if (!slot || !c.scoutDeliveryDate) continue;

    const fromDay = jstYmd(slot.deliveryDate);
    const targetDay = jstYmd(c.scoutDeliveryDate);
    if (fromDay === targetDay) continue; // 既に正しい日の枠 → 対象外

    const machineLabel =
      slot.machine?.machineLabel ?? slot.machine?.recruiterName ?? slot.machineId ?? "(不明)";

    if (!slot.machineId) {
      plans.push({
        candidateId: c.id,
        candidateNumber: c.candidateNumber,
        name: c.name,
        machineLabel,
        fromDay,
        targetDay,
        toSlotId: null,
        toScoutNumber: null,
        blockedReason: "現在の枠に machineId が無い",
      });
      continue;
    }

    const target = await pickBestSlot(slot.machineId, toJstDateOnly(c.scoutDeliveryDate));
    if (!target) {
      plans.push({
        candidateId: c.id,
        candidateNumber: c.candidateNumber,
        name: c.name,
        machineLabel,
        fromDay,
        targetDay,
        toSlotId: null,
        toScoutNumber: null,
        blockedReason: `${targetDay} に ${machineLabel} の枠が無い`,
      });
      continue;
    }

    plans.push({
      candidateId: c.id,
      candidateNumber: c.candidateNumber,
      name: c.name,
      machineLabel,
      fromDay,
      targetDay,
      toSlotId: target.slotId,
      toScoutNumber: target.scoutNumber,
      blockedReason: null,
    });
  }

  return plans;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const mode = execute ? "EXECUTE" : "DRY-RUN";
  console.log(`=== T-190 relink-scout-slots [${mode}] ===\n`);

  const plans = await buildRelinkPlans();
  const movable = plans.filter((p) => p.toSlotId != null);
  const blocked = plans.filter((p) => p.toSlotId == null);

  console.log(`対象件数: ${plans.length}`);
  console.log(`  ├─ 移動: ${movable.length} 件`);
  console.log(`  └─ 移動不可: ${blocked.length} 件\n`);

  if (movable.length > 0) {
    console.log(`--- 移動一覧 (${movable.length}件) ---`);
    console.log(["求職者番号", "氏名", "担当RC", "枠(前)", "枠(後)"].join("\t"));
    for (const p of movable) {
      console.log([p.candidateNumber, p.name, p.machineLabel, p.fromDay, p.targetDay].join("\t"));
    }
    console.log("");
  }

  if (blocked.length > 0) {
    console.log(`--- 移動不可一覧 (${blocked.length}件・現状維持) ---`);
    console.log(["求職者番号", "氏名", "担当RC", "配信日", "枠(現状)", "理由"].join("\t"));
    for (const p of blocked) {
      console.log(
        [p.candidateNumber, p.name, p.machineLabel, p.targetDay, p.fromDay, p.blockedReason ?? ""].join("\t"),
      );
    }
    console.log("");
  }

  if (!execute) {
    console.log(`[DRY-RUN] DB は更新していません。--execute で ${movable.length} 件を更新します。`);
    await cleanup();
    return;
  }

  console.log(`[EXECUTE] ${movable.length} 件を更新します...`);
  let updated = 0;
  for (const p of movable) {
    await prisma.candidate.update({
      where: { id: p.candidateId },
      // scoutDeliveryDate / masType / applicationDate は触らない
      data: { scoutDeliverySlotId: p.toSlotId!, scoutNumber: p.toScoutNumber! },
    });
    updated++;
  }
  console.log(`[EXECUTE] 完了: ${updated} 件を張り替えました（移動不可 ${blocked.length} 件は現状維持）。`);
  await cleanup();
}

async function cleanup() {
  await prisma.$disconnect();
  const g = globalThis as unknown as { pool?: { end: () => Promise<void> } };
  if (g.pool) await g.pool.end();
}

// import されたとき（③のリスト出力）は main を走らせない
const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("relink-scout-slots-t190.ts");
if (invokedDirectly) {
  main().catch(async (e) => {
    console.error(e);
    await cleanup().catch(() => {});
    process.exit(1);
  });
}
