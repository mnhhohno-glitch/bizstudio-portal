/**
 * T-135 Task4: 既存スカウト紐付けの「配信日ベース」再紐付けスクリプト
 *
 * 背景:
 *   従来の auto-link は応募日で当日の配信枠に紐付けていた（T-064）。T-135 で
 *   紐付けを配信日（Candidate.scoutDeliveryDate）ベースへ変更したのに合わせ、
 *   既存の紐付き候補者も配信日ベースへ付け替える。
 *
 * 対象:
 *   scoutDeliverySlotId IS NOT NULL
 *   かつ scoutDeliveryDate IS NOT NULL
 *   かつ JST暦日(scoutDeliveryDate) <> JST暦日(現在の紐付き枠.deliveryDate)
 *
 * 処理:
 *   現在の紐付き枠と同一 machineId（同一配信者）の、scoutDeliveryDate の日の枠を
 *   pickBestSlot（現行 auto-link の枠選択ロジック）で選び、scoutDeliverySlotId /
 *   scoutNumber を付け替える。移動先が無ければ現状維持（「移動不可」として一覧化）。
 *   scoutDeliveryDate IS NULL の紐付き候補者は対象外（件数のみ報告）。
 *
 * 実行:
 *   npx tsx scripts/relink-scout-candidates-t135.ts            # dry-run（既定）
 *   npx tsx scripts/relink-scout-candidates-t135.ts --dry-run  # dry-run
 *   npx tsx scripts/relink-scout-candidates-t135.ts --execute  # 本番DB更新
 *
 * idempotent: 移動済み（同日）は対象外になるため再実行しても安全。
 * DB は Candidate のみ更新（scoutDeliverySlotId, scoutNumber）。枠の新規作成はしない。
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { pickBestSlot, toJstDateOnly } from "../src/lib/scout/auto-link";

/** JST 暦日 YYYY-MM-DD（罠#17） */
function jstYmd(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

async function main() {
  const execute = process.argv.includes("--execute");
  const mode = execute ? "EXECUTE" : "DRY-RUN";
  console.log(`=== T-135 relink-scout-candidates [${mode}] ===\n`);

  const linked = await prisma.candidate.findMany({
    where: { scoutDeliverySlotId: { not: null } },
    select: {
      id: true,
      candidateNumber: true,
      scoutDeliveryDate: true,
      scoutLinkedById: true,
      scoutDeliverySlot: {
        select: {
          id: true,
          deliveryDate: true,
          machineId: true,
          scoutNumber: true,
          machine: { select: { machineLabel: true, recruiterName: true } },
        },
      },
    },
  });

  const nullDeliveryDate = linked.filter((c) => c.scoutDeliveryDate == null);
  const hasDeliveryDate = linked.filter((c) => c.scoutDeliveryDate != null);

  type Plan = {
    candidateNumber: string;
    from: string;
    to: string;
    machine: string;
    linkKind: string;
    candidateId: string;
    targetSlotId: string;
    targetScoutNumber: string;
  };
  const toMove: Plan[] = [];
  const cannotMove: Array<{ candidateNumber: string; from: string; to: string; machine: string }> = [];
  let sameDay = 0;

  for (const c of hasDeliveryDate) {
    const slot = c.scoutDeliverySlot;
    if (!slot) continue;
    const currentDay = jstYmd(slot.deliveryDate);
    const targetDay = jstYmd(c.scoutDeliveryDate!);
    if (currentDay === targetDay) {
      sameDay++;
      continue;
    }
    const machineLabel =
      slot.machine?.machineLabel ?? slot.machine?.recruiterName ?? slot.machineId ?? "(不明)";
    const linkKind = c.scoutLinkedById ? `manual(${c.scoutLinkedById.slice(0, 8)})` : "auto";

    if (!slot.machineId) {
      cannotMove.push({ candidateNumber: c.candidateNumber, from: currentDay, to: targetDay, machine: machineLabel });
      continue;
    }

    const targetDate = toJstDateOnly(c.scoutDeliveryDate!);
    const target = await pickBestSlot(slot.machineId, targetDate);
    if (!target) {
      cannotMove.push({ candidateNumber: c.candidateNumber, from: currentDay, to: targetDay, machine: machineLabel });
      continue;
    }

    toMove.push({
      candidateNumber: c.candidateNumber,
      from: currentDay,
      to: jstYmd(target.deliveryDate),
      machine: machineLabel,
      linkKind,
      candidateId: c.id,
      targetSlotId: target.slotId,
      targetScoutNumber: target.scoutNumber,
    });
  }

  // ---- レポート ----
  console.log(`紐付き候補者 総数: ${linked.length}`);
  console.log(`  ├─ scoutDeliveryDate 有り: ${hasDeliveryDate.length}`);
  console.log(`  │    ├─ 同日（移動不要）: ${sameDay}`);
  console.log(`  │    ├─ 移動対象: ${toMove.length}`);
  console.log(`  │    └─ 移動不可（移動先枠なし）: ${cannotMove.length}`);
  console.log(`  └─ scoutDeliveryDate NULL（対象外・現状維持）: ${nullDeliveryDate.length}\n`);

  if (toMove.length > 0) {
    console.log(`--- 移動対象一覧 (${toMove.length}件) ---`);
    console.log(["candidateNumber", "現枠日", "移動先日", "配信者", "紐付種別"].join("\t"));
    for (const p of toMove) {
      console.log([p.candidateNumber, p.from, p.to, p.machine, p.linkKind].join("\t"));
    }
    console.log("");
  }

  if (cannotMove.length > 0) {
    console.log(`--- 移動不可一覧 (${cannotMove.length}件・現状維持) ---`);
    console.log(["candidateNumber", "現枠日", "希望日", "配信者"].join("\t"));
    for (const p of cannotMove) {
      console.log([p.candidateNumber, p.from, p.to, p.machine].join("\t"));
    }
    console.log("");
  }

  if (!execute) {
    console.log(`[DRY-RUN] DB は更新していません。--execute で ${toMove.length} 件を更新します。`);
    await cleanup();
    return;
  }

  // ---- EXECUTE ----
  console.log(`[EXECUTE] ${toMove.length} 件を更新します...`);
  let updated = 0;
  for (const p of toMove) {
    await prisma.candidate.update({
      where: { id: p.candidateId },
      data: {
        scoutDeliverySlotId: p.targetSlotId,
        scoutNumber: p.targetScoutNumber,
      },
    });
    updated++;
  }
  console.log(`[EXECUTE] 完了: ${updated} 件を再紐付けしました。`);
  await cleanup();
}

async function cleanup() {
  await prisma.$disconnect();
  const g = globalThis as unknown as { pool?: { end: () => Promise<void> } };
  if (g.pool) await g.pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
