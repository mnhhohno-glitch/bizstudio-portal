/**
 * T-064 Phase A: 配信枠ヘルパー
 */

import { prisma } from "@/lib/prisma";
import { reserveScoutNumbers } from "./scout-number";

export const HOUR_SLOTS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] as const;

/**
 * 指定日（JST 解釈、Date 型では UTC の 00:00:00 に揃える）の配信枠を全担当者×全時間帯ぶん作成する。
 * 既に1件でも存在する場合はスキップ。
 */
export async function createDailySlots(targetDate: Date): Promise<{
  created: number;
  skipped: boolean;
}> {
  // 既存チェック
  const existing = await prisma.scoutDeliverySlot.findFirst({
    where: { deliveryDate: targetDate },
  });
  if (existing) {
    return { created: 0, skipped: true };
  }

  // 全担当者を取得（停止中も含めて作成、isAggregationTarget で振り分け）
  const machines = await prisma.scoutMachineMaster.findMany({
    orderBy: [{ isMachine: "desc" }, { machineNumber: "asc" }, { recruiterName: "asc" }],
  });

  const totalSlots = machines.length * HOUR_SLOTS.length;
  const scoutNumbers = await reserveScoutNumbers(totalSlots);

  const data: Array<{
    scoutNumber: string;
    deliveryDate: Date;
    hourSlot: number;
    machineId: string;
    isMachine: boolean;
    isStaff: boolean;
    deliveryCategoryLarge: string;
    deliveryCategoryMedium: string | null;
    deliveryCategorySmall: string | null;
    mediaSource: string;
    isAggregationTarget: boolean;
  }> = [];

  let idx = 0;
  for (const m of machines) {
    for (const hour of HOUR_SLOTS) {
      const isStaff = !m.isMachine;
      data.push({
        scoutNumber: scoutNumbers[idx++],
        deliveryDate: targetDate,
        hourSlot: hour,
        machineId: m.id,
        isMachine: m.isMachine,
        isStaff,
        deliveryCategoryLarge: m.isMachine ? "RPA" : "社員",
        deliveryCategoryMedium: m.isMachine ? "個別配信" : null,
        deliveryCategorySmall: m.isMachine ? "検索条件指定" : null,
        mediaSource: "マイナビ転職",
        // RPA: 稼働中のみ集計対象 / 社員: 後で入力されたら true へ
        isAggregationTarget: m.isMachine ? m.isActive : false,
      });
    }
  }

  await prisma.scoutDeliverySlot.createMany({ data, skipDuplicates: true });

  return { created: data.length, skipped: false };
}

/**
 * YYYY-MM-DD 文字列を UTC 00:00 の Date に変換（DB の @db.Date カラム用）
 */
export function parseSlotDate(s: string): Date {
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) throw new Error(`Invalid date format: ${s}`);
  return new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])));
}

/**
 * 日本時間の「翌日」を UTC 00:00 の Date で取得
 */
export function getTomorrowJst(): Date {
  // JST = UTC+9
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const tomorrowJst = new Date(jstNow);
  tomorrowJst.setUTCDate(tomorrowJst.getUTCDate() + 1);
  return new Date(
    Date.UTC(
      tomorrowJst.getUTCFullYear(),
      tomorrowJst.getUTCMonth(),
      tomorrowJst.getUTCDate(),
    ),
  );
}
