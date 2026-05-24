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
import {
  createDailySlots,
  parseSlotDate,
  getTomorrowJst,
} from "@/lib/scout/slot-helpers";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const log = await prisma.scoutImportLog.create({
    data: {
      importType: "DAILY_EXCEL", // 配信枠作成は import ではないが共通ログで管理
      status: "RUNNING",
    },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const targetDate =
      typeof body?.targetDate === "string" && body.targetDate.trim()
        ? parseSlotDate(body.targetDate)
        : getTomorrowJst();

    await prisma.scoutImportLog.update({
      where: { id: log.id },
      data: { targetDate, importType: "MANUAL" },
    });

    const result = await createDailySlots(targetDate);

    await prisma.scoutImportLog.update({
      where: { id: log.id },
      data: {
        status: "COMPLETED",
        totalRows: result.created,
        successCount: result.created,
        finishedAt: new Date(),
        errorMessage: result.skipped ? "既に配信枠が存在するためスキップ" : null,
      },
    });

    return NextResponse.json({
      status: result.skipped ? "SKIPPED" : "CREATED",
      targetDate: targetDate.toISOString().slice(0, 10),
      created: result.created,
      message: result.skipped
        ? "Slots already exist for this date"
        : `Created ${result.created} slots`,
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
