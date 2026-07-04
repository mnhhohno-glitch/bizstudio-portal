/**
 * T-135 Task5: 欠測スカウト配信数の復旧スクリプト
 *
 * 対象:
 *   - 2026-07-01 の 1〜3号機（全時間帯）… AGGREGATED_JSON インポート未実行で全枠 deliveryCount=0
 *   - 2026-06-30 の 1号機のみ … 1号機分だけ集計から欠落（2・3号機は正常＝更新禁止）
 *
 * 規約（既存 aggregated-importer に合わせる）:
 *   - 配信枠は hourSlot 8〜19 のみ存在する。早朝（5時台など 8時未満）の送信は 8時枠へ畳み込む。
 *     → stored[8] = Excel[5..7] の合計 + Excel[8]、hours 9-19 は 1:1。
 *   - 更新対象は RPA/個別配信 の枠（createDailySlots が作る集計枠）。deliveryCount を上書き。
 *
 * 事前検証:
 *   書き込み前に 2026-07-02 / 2026-07-03（DB実値が Excel と一致済み）で規約を突合し、
 *   Excel→畳み込み後の期待値と DB 実値が全一致することを確認する。
 *
 * 実行:
 *   npx tsx scripts/restore-scout-delivery-t135.ts            # 検証 + dry-run（既定）
 *   npx tsx scripts/restore-scout-delivery-t135.ts --execute  # 本番DB更新
 *
 * idempotent: 現在値と新値が一致する枠はスキップ。
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { parseSlotDate } from "../src/lib/scout/slot-helpers";

/** 号機 -> { hour(送信時刻の時間帯) -> 件数 }。Excel実測（送信成功のみ・hour5 は畳み込み前の生値）。 */
type ByHour = Record<number, number>;
type ByMachine = Record<number, ByHour>;

// 復旧対象（書き込み）
const RESTORE: Record<string, ByMachine> = {
  "2026-07-01": {
    1: { 5: 56, 8: 29, 9: 59, 10: 57, 11: 41, 12: 65, 13: 63, 14: 31, 15: 42, 16: 4, 17: 2, 18: 5, 19: 6 },
    2: { 5: 0, 8: 26, 9: 54, 10: 53, 11: 40, 12: 50, 13: 39, 14: 31, 15: 13, 16: 57, 17: 49, 18: 55, 19: 53 },
    3: { 5: 0, 8: 26, 9: 58, 10: 55, 11: 33, 12: 62, 13: 62, 14: 52, 15: 14, 16: 3, 17: 3, 18: 5, 19: 10 },
  },
  "2026-06-30": {
    1: { 5: 42, 8: 28, 9: 56, 10: 58, 11: 15, 12: 2, 13: 1, 14: 1, 15: 26, 16: 6, 17: 6, 18: 3, 19: 3 },
  },
};

// 検証専用（書き込み禁止）。DB実値と突合して規約の正しさを確認する。
const VERIFY: Record<string, ByMachine> = {
  "2026-07-02": {
    1: { 5: 56, 8: 27, 9: 60, 10: 53, 11: 49, 12: 20, 13: 38, 14: 61, 15: 58, 16: 58, 17: 54, 18: 58, 19: 45 },
    2: { 5: 0, 8: 27, 9: 58, 10: 48, 11: 46, 12: 49, 13: 40, 14: 40, 15: 1, 16: 6, 17: 48, 18: 53, 19: 52 },
    3: { 5: 0, 8: 27, 9: 60, 10: 47, 11: 42, 12: 22, 13: 7, 14: 18, 15: 52, 16: 53, 17: 45, 18: 54, 19: 40 },
  },
  "2026-07-03": {
    1: { 5: 55, 8: 23, 9: 49, 10: 50, 11: 47, 12: 56, 13: 50, 14: 36, 15: 41, 16: 6, 17: 39, 18: 53, 19: 59 },
    2: { 5: 0, 8: 23, 9: 45, 10: 44, 11: 44, 12: 44, 13: 33, 14: 38, 15: 5, 16: 50, 17: 37, 18: 48, 19: 55 },
    3: { 5: 0, 8: 0, 9: 43, 10: 50, 11: 43, 12: 54, 13: 54, 14: 60, 15: 56, 16: 42, 17: 40, 18: 51, 19: 53 },
  },
};

/** 早朝(8時未満)を8時枠へ畳み込み、hourSlot 8〜19 の格納値を返す。 */
function foldToSlots(byHour: ByHour): ByHour {
  const out: ByHour = {};
  for (let h = 8; h <= 19; h++) out[h] = byHour[h] ?? 0;
  for (let h = 0; h < 8; h++) out[8] += byHour[h] ?? 0; // 早朝送信は8時枠へ
  return out;
}

/** machineNumber -> machineId を解決（isMachine=true, machineNumber 1..N）。1:1でなければ throw。 */
async function resolveMachineIds(numbers: number[]): Promise<Map<number, string>> {
  const masters = await prisma.scoutMachineMaster.findMany({
    where: { isMachine: true, machineNumber: { in: numbers } },
  });
  const map = new Map<number, string>();
  for (const n of numbers) {
    const hits = masters.filter((m) => m.machineNumber === n);
    if (hits.length !== 1) {
      throw new Error(`machineNumber=${n} が一意に解決できません（${hits.length}件）`);
    }
    map.set(n, hits[0].id);
  }
  return map;
}

/** 指定 (day, machineId, hourSlot) の RPA/個別配信 枠を1件取得。0件/複数件は null と件数を返す。 */
async function findRpaSlot(day: Date, machineId: string, hourSlot: number) {
  const slots = await prisma.scoutDeliverySlot.findMany({
    where: {
      deliveryDate: day,
      machineId,
      hourSlot,
      deliveryCategoryLarge: "RPA",
      deliveryCategoryMedium: "個別配信",
    },
    select: { id: true, scoutNumber: true, deliveryCount: true },
  });
  return { slot: slots[0] ?? null, count: slots.length };
}

async function runVerify(machineIds: Map<number, string>): Promise<boolean> {
  console.log(`=== 規約検証（7/2・7/3 を DB実値と突合。書き込みなし）===`);
  let compared = 0;
  let matched = 0;
  const diffs: string[] = [];
  const ambiguous: string[] = [];

  for (const [dayStr, byMachine] of Object.entries(VERIFY)) {
    const day = parseSlotDate(dayStr);
    for (const [mnStr, byHour] of Object.entries(byMachine)) {
      const mn = Number(mnStr);
      const machineId = machineIds.get(mn)!;
      const folded = foldToSlots(byHour);
      for (let h = 8; h <= 19; h++) {
        const expected = folded[h];
        const { slot, count } = await findRpaSlot(day, machineId, h);
        if (count !== 1) {
          ambiguous.push(`${dayStr} ${mn}号機 ${h}時: RPA/個別配信枠が ${count} 件`);
          continue;
        }
        compared++;
        if (slot!.deliveryCount === expected) matched++;
        else diffs.push(`${dayStr} ${mn}号機 ${h}時: DB=${slot!.deliveryCount} 期待=${expected}`);
      }
    }
  }

  console.log(`  比較セル数: ${compared} / 一致: ${matched} / 不一致: ${diffs.length} / 枠特定不能: ${ambiguous.length}`);
  if (ambiguous.length > 0) {
    console.log(`  [枠特定不能]`);
    ambiguous.forEach((s) => console.log(`    ${s}`));
  }
  if (diffs.length > 0) {
    console.log(`  [不一致]`);
    diffs.forEach((s) => console.log(`    ${s}`));
    console.log(`  ⚠️ 規約の解釈が DB と一致しません。上記差分を確認してください（続行はします）。`);
    return false;
  }
  console.log(`  ✅ 全一致。畳み込み規約（早朝→8時枠 / hours 9-19 は 1:1 / RPA・個別配信枠を上書き）は正しい。\n`);
  return true;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const mode = execute ? "EXECUTE" : "DRY-RUN";
  console.log(`=== T-135 restore-scout-delivery [${mode}] ===\n`);

  const allNumbers = [1, 2, 3];
  const machineIds = await resolveMachineIds(allNumbers);
  console.log(`machineNumber -> machineId:`);
  for (const n of allNumbers) console.log(`  ${n}号機 -> ${machineIds.get(n)}`);
  console.log("");

  await runVerify(machineIds);

  // ---- 復旧対象の dry-run / execute ----
  type Update = { day: string; mn: number; hour: number; slotId: string; scoutNumber: string; from: number; to: number };
  const updates: Update[] = [];
  const skipped: Update[] = [];
  const missing: string[] = [];

  for (const [dayStr, byMachine] of Object.entries(RESTORE)) {
    const day = parseSlotDate(dayStr);
    for (const [mnStr, byHour] of Object.entries(byMachine)) {
      const mn = Number(mnStr);
      const machineId = machineIds.get(mn)!;
      const folded = foldToSlots(byHour);
      for (let h = 8; h <= 19; h++) {
        const to = folded[h];
        const { slot, count } = await findRpaSlot(day, machineId, h);
        if (count !== 1 || !slot) {
          missing.push(`${dayStr} ${mn}号機 ${h}時: RPA/個別配信枠が ${count} 件（スキップ）`);
          continue;
        }
        const rec: Update = { day: dayStr, mn, hour: h, slotId: slot.id, scoutNumber: slot.scoutNumber, from: slot.deliveryCount, to };
        if (slot.deliveryCount === to) skipped.push(rec);
        else updates.push(rec);
      }
    }
  }

  // 復旧後の日合計（期待値確認）
  const dayTotals: Record<string, number> = {};
  for (const [dayStr, byMachine] of Object.entries(RESTORE)) {
    let t = 0;
    for (const byHour of Object.values(byMachine)) {
      const folded = foldToSlots(byHour);
      for (let h = 8; h <= 19; h++) t += folded[h];
    }
    dayTotals[dayStr] = t;
  }

  console.log(`--- 復旧対象 ---`);
  console.log(`更新: ${updates.length} 件 / スキップ(既に一致): ${skipped.length} 件 / 枠なし: ${missing.length} 件\n`);
  console.log(["day", "号機", "hour", "scoutNumber", "現在値", "→新値"].join("\t"));
  for (const u of updates) {
    console.log([u.day, `${u.mn}号機`, `${u.hour}時`, u.scoutNumber, u.from, u.to].join("\t"));
  }
  if (missing.length > 0) {
    console.log(`\n[枠なし]`);
    missing.forEach((s) => console.log(`  ${s}`));
  }
  console.log(`\n復旧により書き込む各号機分の日合計（畳み込み後）:`);
  console.log(`  2026-07-01（1〜3号機）= ${dayTotals["2026-07-01"]}（期待 1363）`);
  console.log(`  2026-06-30（1号機のみ）= ${dayTotals["2026-06-30"]}（期待 247 / 既存2・3号機と合算で日合計1275）`);

  if (!execute) {
    console.log(`\n[DRY-RUN] DB は更新していません。--execute で ${updates.length} 件を上書きします。`);
    await cleanup();
    return;
  }

  // ---- EXECUTE ----
  console.log(`\n[EXECUTE] ${updates.length} 件を上書きします...`);
  const perDayCount: Record<string, number> = {};
  for (const u of updates) {
    await prisma.scoutDeliverySlot.update({
      where: { id: u.slotId },
      data: { deliveryCount: u.to },
    });
    perDayCount[u.day] = (perDayCount[u.day] ?? 0) + 1;
  }
  // 実行記録（既存インポートと同形式・日ごとに MANUAL ログ1件）
  for (const dayStr of Object.keys(RESTORE)) {
    await prisma.scoutImportLog.create({
      data: {
        importType: "MANUAL",
        fileName: `T-135 restore-scout-delivery ${dayStr}`,
        targetDate: parseSlotDate(dayStr),
        totalRows: perDayCount[dayStr] ?? 0,
        successCount: perDayCount[dayStr] ?? 0,
        failureCount: 0,
        status: "COMPLETED",
        finishedAt: new Date(),
      },
    });
  }
  console.log(`[EXECUTE] 完了: ${updates.length} 件を更新し、ScoutImportLog を ${Object.keys(RESTORE).length} 件記録しました。`);
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
