import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { SCOUT_EXCEL_FORMAT } from "@/lib/scout/excel-import-config";
import { parseSlotDate } from "@/lib/scout/slot-helpers";

export interface DailyExcelImportInput {
  fileBuffer: ArrayBuffer;
  targetDate: string; // YYYY-MM-DD
  fileName?: string;
  importType: string;
}

export interface DailyExcelImportResult {
  status: "COMPLETED" | "FAILED";
  targetDate: string;
  successCount: number;
  failureCount: number;
  errors: string[];
}

export async function importDailyScoutExcel(
  input: DailyExcelImportInput,
): Promise<DailyExcelImportResult> {
  const targetDate = parseSlotDate(input.targetDate);

  const log = await prisma.scoutImportLog.create({
    data: {
      importType: input.importType,
      status: "RUNNING",
      targetDate,
      fileName: input.fileName ?? null,
    },
  });

  try {
    const workbook = XLSX.read(input.fileBuffer, { type: "array" });
    const sheet = workbook.Sheets[SCOUT_EXCEL_FORMAT.sheetName];
    if (!sheet) {
      throw new Error(
        `シート "${SCOUT_EXCEL_FORMAT.sheetName}" が見つかりません`,
      );
    }

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
    });

    const slots = await prisma.scoutDeliverySlot.findMany({
      where: {
        deliveryDate: targetDate,
        isMachine: true,
      },
      include: { machine: true },
    });

    let successCount = 0;
    let failureCount = 0;
    const errors: string[] = [];

    for (
      let i = SCOUT_EXCEL_FORMAT.dataStartRowIndex;
      i < SCOUT_EXCEL_FORMAT.dataStartRowIndex + SCOUT_EXCEL_FORMAT.dataRowCount;
      i++
    ) {
      const row = rows[i];
      if (!row) continue;
      const hourCell = row[SCOUT_EXCEL_FORMAT.timeColumnIndex];
      const hour = SCOUT_EXCEL_FORMAT.parseHour(hourCell);
      if (hour === null) continue;

      for (const [machineNumStr, colIdx] of Object.entries(
        SCOUT_EXCEL_FORMAT.machineColumnMap,
      )) {
        const machineNumber = parseInt(machineNumStr, 10);
        const cell = row[colIdx];
        const count = typeof cell === "number" ? Math.trunc(cell) : Number(cell);
        if (!Number.isFinite(count) || count < 0) continue;

        const slot = slots.find(
          (s) => s.hourSlot === hour && s.machine?.machineNumber === machineNumber,
        );
        if (!slot) {
          failureCount++;
          errors.push(`枠が見つかりません: ${hour}時 ${machineNumber}号機`);
          continue;
        }

        try {
          await prisma.scoutDeliverySlot.update({
            where: { id: slot.id },
            data: { deliveryCount: count },
          });
          successCount++;
        } catch (e) {
          failureCount++;
          errors.push(
            `更新失敗: ${hour}時 ${machineNumber}号機 - ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    await prisma.scoutImportLog.update({
      where: { id: log.id },
      data: {
        status: "COMPLETED",
        totalRows: successCount + failureCount,
        successCount,
        failureCount,
        errorMessage: errors.length > 0 ? errors.slice(0, 20).join("\n") : null,
        finishedAt: new Date(),
      },
    });

    return {
      status: "COMPLETED",
      targetDate: input.targetDate,
      successCount,
      failureCount,
      errors: errors.slice(0, 20),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[scout/import/${input.importType}] error:`, msg);
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
