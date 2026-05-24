import { prisma } from "@/lib/prisma";
import { parseSlotDate } from "@/lib/scout/slot-helpers";
import { createSlotsForDate } from "@/lib/scout/slot-creator";

export interface AggregatedDataItem {
  machineNumber: number;
  hourSlot: number;
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
    reason: string;
  }>;
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
    const errors: Array<{ machineNumber: number; hourSlot: number; reason: string }> = [];

    for (const item of params.data) {
      const machineId = machineMap.get(item.machineNumber);
      if (!machineId) {
        skippedCount++;
        errors.push({
          machineNumber: item.machineNumber,
          hourSlot: item.hourSlot,
          reason: "machine not found",
        });
        continue;
      }

      const slot = slots.find(
        (s) => s.machineId === machineId && s.hourSlot === item.hourSlot,
      );
      if (!slot) {
        skippedCount++;
        errors.push({
          machineNumber: item.machineNumber,
          hourSlot: item.hourSlot,
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

    await prisma.scoutImportLog.update({
      where: { id: log.id },
      data: {
        status: "COMPLETED",
        totalRows: successCount + skippedCount,
        successCount,
        failureCount: skippedCount,
        errorMessage:
          errors.length > 0
            ? errors.slice(0, 20).map((e) => `${e.machineNumber}号機 ${e.hourSlot}時: ${e.reason}`).join("\n")
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
