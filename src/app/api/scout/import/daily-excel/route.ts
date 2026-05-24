/**
 * T-064 Phase A: 配信数取り込み API（OneDrive エクセル）
 *
 * POST /api/scout/import/daily-excel
 *   認証: x-rpa-secret ヘッダ
 *   リクエスト: multipart/form-data
 *     - file: エクセル（xlsx）
 *     - targetDate: "YYYY-MM-DD"
 *   想定エクセル:
 *     シート "サマリ"
 *     A列=送信時間("8:00".."19:00"), B〜G列=1〜6号機 配信数
 *
 * 想定呼び出し: 毎晩 02:00 JST に Power Automate Cloud Flow から呼ぶ
 */

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { SCOUT_EXCEL_FORMAT } from "@/lib/scout/excel-import-config";
import { parseSlotDate } from "@/lib/scout/slot-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const log = await prisma.scoutImportLog.create({
    data: { importType: "DAILY_EXCEL", status: "RUNNING" },
  });

  try {
    const form = await req.formData();
    const file = form.get("file");
    const targetDateRaw = form.get("targetDate");

    if (!(file instanceof File)) {
      throw new Error("file は必須です（multipart/form-data）");
    }
    if (typeof targetDateRaw !== "string" || !targetDateRaw.trim()) {
      throw new Error("targetDate は必須です（YYYY-MM-DD）");
    }

    const targetDate = parseSlotDate(targetDateRaw);
    const fileName = file.name;

    await prisma.scoutImportLog.update({
      where: { id: log.id },
      data: { targetDate, fileName },
    });

    // エクセル読み取り
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const sheet = workbook.Sheets[SCOUT_EXCEL_FORMAT.sheetName];
    if (!sheet) {
      throw new Error(
        `シート "${SCOUT_EXCEL_FORMAT.sheetName}" が見つかりません`,
      );
    }

    // 配列形式（2次元配列）で取得
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
    });

    // 対象日のスロット（機械分）を全件取得
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

    // データ行をループ
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

    return NextResponse.json({
      status: "COMPLETED",
      targetDate: targetDateRaw,
      successCount,
      failureCount,
      errors: errors.slice(0, 20),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[scout/import/daily-excel] error:", msg);
    await prisma.scoutImportLog.update({
      where: { id: log.id },
      data: {
        status: "FAILED",
        errorMessage: msg,
        finishedAt: new Date(),
      },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
