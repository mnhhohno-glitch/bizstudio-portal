/**
 * T-064 Phase A 追加: 集計済みデータ取込 API
 *
 * POST /api/scout/import/aggregated
 *   認証: x-rpa-secret ヘッダ
 *   Content-Type: application/json
 *   Body: { targetDate, data: [{ machineNumber, hourSlot, deliveryCount }] }
 *
 * 7号機 PAD が 06.送信結果蓄積ファイル_X号機.xlsx を集計し、
 * 時間×号機別の配信数 JSON を送信する。
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import {
  importAggregatedScoutData,
  type AggregatedDataItem,
} from "@/lib/scout/aggregated-importer";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { targetDate, data, autoCreateSlots } = body as {
      targetDate?: string;
      data?: unknown[];
      autoCreateSlots?: boolean;
    };

    if (!targetDate || typeof targetDate !== "string" || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(targetDate.trim())) {
      return NextResponse.json(
        { error: "targetDate は必須です（YYYY-MM-DD）" },
        { status: 400 },
      );
    }

    if (!Array.isArray(data) || data.length === 0) {
      return NextResponse.json(
        { error: "data は1件以上の配列が必須です" },
        { status: 400 },
      );
    }

    const validatedData: AggregatedDataItem[] = [];
    const validationErrors: string[] = [];

    for (let i = 0; i < data.length; i++) {
      const item = data[i] as Record<string, unknown>;
      const mn = item?.machineNumber;
      const hs = item?.hourSlot;
      const dc = item?.deliveryCount;

      if (
        typeof mn !== "number" || mn < 1 || mn > 6 ||
        typeof hs !== "number" || hs < 8 || hs > 19 ||
        typeof dc !== "number" || dc < 0 || !Number.isInteger(dc)
      ) {
        validationErrors.push(
          `data[${i}]: machineNumber=${mn}, hourSlot=${hs}, deliveryCount=${dc}`,
        );
        continue;
      }

      validatedData.push({
        machineNumber: mn,
        hourSlot: hs,
        deliveryCount: dc,
      });
    }

    if (validatedData.length === 0) {
      return NextResponse.json(
        { error: "有効なデータが0件です", validationErrors: validationErrors.slice(0, 10) },
        { status: 400 },
      );
    }

    const result = await importAggregatedScoutData({
      targetDate: targetDate.trim(),
      data: validatedData,
      autoCreateSlots: autoCreateSlots === true,
    });

    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
