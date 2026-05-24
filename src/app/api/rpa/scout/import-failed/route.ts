/**
 * T-064: スカウト配信実績集計 失敗通知 API
 *
 * POST /api/rpa/scout/import-failed
 *   認証: x-rpa-secret ヘッダ
 *   Content-Type: application/json
 *   Body: { targetDate, errorMessage, processLog? }
 *
 * 7号機 PAD の「03.スカウト配信実績集計」失敗時に呼ばれ、
 * LINE WORKS トークルームに通知する。
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { sendBotMessage } from "@/lib/lineworks";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { targetDate, errorMessage, processLog } = body as {
      targetDate?: string;
      errorMessage?: string;
      processLog?: string[];
    };

    if (!targetDate || typeof targetDate !== "string" || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(targetDate.trim())) {
      return NextResponse.json(
        { error: "targetDate は必須です（YYYY-MM-DD）" },
        { status: 400 },
      );
    }

    if (!errorMessage || typeof errorMessage !== "string" || !errorMessage.trim()) {
      return NextResponse.json(
        { error: "errorMessage は必須です" },
        { status: 400 },
      );
    }

    const botId = process.env.LINEWORKS_MYNAVI_BOT_ID;
    const channelId = process.env.LINEWORKS_MYNAVI_CHANNEL_ID;

    if (!botId || !channelId) {
      console.warn("[rpa/scout/import-failed] LINEWORKS_MYNAVI_* が未設定のため通知をスキップ");
      return NextResponse.json({
        status: "SKIPPED",
        targetDate: targetDate.trim(),
        reason: "LINE WORKS credentials not configured",
      });
    }

    const lines = [
      "🚨 スカウト配信実績集計 失敗",
      `対象日: ${targetDate.trim()}`,
      "",
      `エラー: ${errorMessage.trim()}`,
    ];

    if (Array.isArray(processLog) && processLog.length > 0) {
      lines.push("");
      lines.push("詳細:");
      for (const entry of processLog.slice(0, 20)) {
        if (typeof entry === "string") {
          lines.push(entry);
        }
      }
    }

    await sendBotMessage(botId, channelId, lines.join("\n"));

    return NextResponse.json({
      status: "NOTIFIED",
      targetDate: targetDate.trim(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[rpa/scout/import-failed] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
