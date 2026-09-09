import { prisma } from "@/lib/prisma";
import { parseSlotDate, formatSlotTime } from "@/lib/scout/slot-helpers";
import { createSlotsForDate } from "@/lib/scout/slot-creator";

export interface AggregatedDataItem {
  machineNumber: number;
  hourSlot: number;
  /** 分（0 / 30）。省略時は 0（後方互換: Power Automate は当面 {machineNumber, hourSlot, deliveryCount} のみ送る） */
  minuteSlot?: number;
  deliveryCount: number;
}

export interface AggregatedImportResult {
  status: "COMPLETED" | "FAILED";
  targetDate: string;
  successCount: number;
  skippedCount: number;
  slotsAutoCreated?: number;
  errors: Array<{
    machineNumber: number;
    hourSlot: number;
    minuteSlot: number;
    reason: string;
  }>;
  /**
   * 追加キー（既存キーは削除・改名しない。外部 RPA はプロパティ欠落で例外停止する）:
   * 取込側で落とした行の内訳。route 側で validation 件数と合算して返す。
   */
  skipped: {
    machineNotFound: number;
    slotNotFound: number;
  };
}

export async function importAggregatedScoutData(params: {
  targetDate: string;
  data: AggregatedDataItem[];
  autoCreateSlots?: boolean;
}): Promise<AggregatedImportResult> {
  const targetDate = parseSlotDate(params.targetDate);

  const log = await prisma.scoutImportLog.create({
    data: {
      importType: "AGGREGATED_JSON",
      status: "RUNNING",
      targetDate,
    },
  });

  try {
    let slotsAutoCreated: number | undefined;

    let slots = await prisma.scoutDeliverySlot.findMany({
      where: {
        deliveryDate: targetDate,
        isMachine: true,
      },
      include: { machine: true },
    });

    if (slots.length === 0) {
      if (params.autoCreateSlots) {
        const createResult = await createSlotsForDate(params.targetDate);
        slotsAutoCreated = createResult.createdCount;
        slots = await prisma.scoutDeliverySlot.findMany({
          where: {
            deliveryDate: targetDate,
            isMachine: true,
          },
          include: { machine: true },
        });
      } else {
        throw new Error(
          `対象日 ${params.targetDate} の配信枠が存在しません。先に配信枠を作成してください。`,
        );
      }
    }

    const machines = await prisma.scoutMachineMaster.findMany({
      where: { isMachine: true },
    });
    const machineMap = new Map(
      machines.filter((m) => m.machineNumber !== null).map((m) => [m.machineNumber!, m.id]),
    );

    let successCount = 0;
    let skippedCount = 0;
    const skipped = { machineNotFound: 0, slotNotFound: 0 };
    const errors: AggregatedImportResult["errors"] = [];

    for (const item of params.data) {
      const minuteSlot = item.minuteSlot ?? 0;
      const machineId = machineMap.get(item.machineNumber);
      if (!machineId) {
        skippedCount++;
        skipped.machineNotFound++;
        errors.push({
          machineNumber: item.machineNumber,
          hourSlot: item.hourSlot,
          minuteSlot,
          reason: "machine not found",
        });
        continue;
      }

      // 枠照合は (machine, hourSlot, minuteSlot) の完全一致。14:00 と 14:30 は別枠。
      const slot = slots.find(
        (s) =>
          s.machineId === machineId &&
          s.hourSlot === item.hourSlot &&
          s.minuteSlot === minuteSlot,
      );
      if (!slot) {
        skippedCount++;
        skipped.slotNotFound++;
        errors.push({
          machineNumber: item.machineNumber,
          hourSlot: item.hourSlot,
          minuteSlot,
          reason: "slot not found",
        });
        continue;
      }

      await prisma.scoutDeliverySlot.update({
        where: { id: slot.id },
        data: { deliveryCount: item.deliveryCount },
      });
      successCount++;
    }

    // 静かに落とさない: 落とした行はサーバーログに件数と内容を残す
    if (errors.length > 0) {
      console.warn(
        `[scout/import/aggregated] ${params.targetDate}: ${skippedCount} 行を未反映で終了 ` +
          `(machine not found=${skipped.machineNotFound}, slot not found=${skipped.slotNotFound})`,
        errors
          .slice(0, 50)
          .map((e) => `${e.machineNumber}号機 ${formatSlotTime(e.hourSlot, e.minuteSlot)}: ${e.reason}`),
      );
    }

    await prisma.scoutImportLog.update({
      where: { id: log.id },
      data: {
        status: "COMPLETED",
        totalRows: successCount + skippedCount,
        successCount,
        failureCount: skippedCount,
        errorMessage:
          errors.length > 0
            ? errors
                .slice(0, 20)
                .map((e) => `${e.machineNumber}号機 ${formatSlotTime(e.hourSlot, e.minuteSlot)}: ${e.reason}`)
                .join("\n")
            : null,
        finishedAt: new Date(),
      },
    });

    return {
      status: "COMPLETED",
      targetDate: params.targetDate,
      successCount,
      skippedCount,
      ...(slotsAutoCreated !== undefined && { slotsAutoCreated }),
      errors: errors.slice(0, 20),
      skipped,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[scout/import/aggregated] error:", msg);
    await prisma.scoutImportLog.update({
      where: { id: log.id },
      data: {
        status: "FAILED",
        errorMessage: msg,
        finishedAt: new Date(),
      },
    });
    throw e;
  }
}
