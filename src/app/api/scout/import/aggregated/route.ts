/**
 * T-064 Phase A 追加: 集計済みデータ取込 API
 *
 * POST /api/scout/import/aggregated
 *   認証: x-rpa-secret ヘッダ
 *   Content-Type: application/json
 *   Body: { targetDate, data: [{ machineNumber, hourSlot, minuteSlot?, deliveryCount }] }
 *     - minuteSlot は任意（0 / 30）。省略時は 0 として扱う（後方互換）。
 *     - (hourSlot, minuteSlot) は SLOT_TIMES（8:00〜19:00 + 14:30）のいずれかであること。
 *
 * 7号機 PAD が 06.送信結果蓄積ファイル_X号機.xlsx を集計し、
 * 時間×号機別の配信数 JSON を送信する。
 *
 * レスポンス: importAggregatedScoutData の結果（既存キーは不変）＋ 追加キー
 *   skipped: { validation, machineNotFound, slotNotFound, total }
 *   validationErrors: string[]（先頭10件）
 *   ※ 外部 RPA(PAD) はプロパティ欠落で例外停止するため、既存キーの削除・改名は禁止。追加のみ。
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import {
  importAggregatedScoutData,
  type AggregatedDataItem,
} from "@/lib/scout/aggregated-importer";
import { isValidSlotTime } from "@/lib/scout/slot-helpers";

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
      const msRaw = item?.minuteSlot;
      // minuteSlot 省略時は 0（正時）。Power Automate 改修までは省略で送られてくる。
      const ms = msRaw === undefined || msRaw === null ? 0 : msRaw;
      const dc = item?.deliveryCount;

      if (
        typeof mn !== "number" || mn < 1 || mn > 6 ||
        !isValidSlotTime(hs, ms) ||
        typeof dc !== "number" || dc < 0 || !Number.isInteger(dc)
      ) {
        validationErrors.push(
          `data[${i}]: machineNumber=${mn}, hourSlot=${hs}, minuteSlot=${msRaw === undefined ? "(省略)" : msRaw}, deliveryCount=${dc}`,
        );
        continue;
      }

      validatedData.push({
        machineNumber: mn,
        hourSlot: hs as number,
        minuteSlot: ms as number,
        deliveryCount: dc,
      });
    }

    // 静かに落とさない: 妥当性チェックで弾いた行は件数と内容をサーバーログに出す
    if (validationErrors.length > 0) {
      console.warn(
        `[scout/import/aggregated] ${targetDate.trim()}: validation で ${validationErrors.length}/${data.length} 行を除外`,
        validationErrors.slice(0, 50),
      );
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

    const skipped = {
      validation: validationErrors.length,
      machineNotFound: result.skipped.machineNotFound,
      slotNotFound: result.skipped.slotNotFound,
      total:
        validationErrors.length + result.skipped.machineNotFound + result.skipped.slotNotFound,
    };

    return NextResponse.json({
      ...result,
      skipped,
      validationErrors: validationErrors.slice(0, 10),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
