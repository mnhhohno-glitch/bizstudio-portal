/**
 * T-064 Phase A: 配信枠自動作成 API
 *
 * POST /api/scout/cron/create-daily-slots
 *   認証: x-rpa-secret ヘッダ
 *   リクエスト: { targetDate?: "YYYY-MM-DD" } 省略時は JST 翌日
 *   レスポンス: { status: "CREATED"|"SKIPPED", targetDate, created, message }
 *
 * 想定呼び出し: 毎晩 02:00 JST に Power Automate Cloud Flow から呼ぶ
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { getTomorrowJst } from "@/lib/scout/slot-helpers";
import { createSlotsForDate } from "@/lib/scout/slot-creator";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const log = await prisma.scoutImportLog.create({
    data: {
      importType: "DAILY_EXCEL",
      status: "RUNNING",
    },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const targetDateStr =
      typeof body?.targetDate === "string" && body.targetDate.trim()
        ? body.targetDate.trim()
        : getTomorrowJst().toISOString().slice(0, 10);

    await prisma.scoutImportLog.update({
      where: { id: log.id },
      data: {
        targetDate: new Date(targetDateStr + "T00:00:00Z"),
        importType: "MANUAL",
      },
    });

    const result = await createSlotsForDate(targetDateStr);

    await prisma.scoutImportLog.update({
      where: { id: log.id },
      data: {
        status: "COMPLETED",
        totalRows: result.createdCount,
        successCount: result.createdCount,
        finishedAt: new Date(),
        errorMessage:
          result.status === "SKIPPED"
            ? "既に配信枠が存在するためスキップ"
            : null,
      },
    });

    return NextResponse.json({
      status: result.status,
      targetDate: result.targetDate,
      created: result.createdCount,
      message:
        result.status === "SKIPPED"
          ? "Slots already exist for this date"
          : `Created ${result.createdCount} slots`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[scout/cron/create-daily-slots] error:", msg);
    await prisma.scoutImportLog.update({
      where: { id: log.id },
      data: {
        status: "FAILED",
        errorMessage: msg,
        finishedAt: new Date(),
      },
    });
    return NextResponse.json(
      { error: `予期しないエラー: ${msg}` },
      { status: 500 },
    );
  }
}
