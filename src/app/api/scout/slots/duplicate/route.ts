/**
 * T-064: 配信レコードの複製 API
 *
 * POST /api/scout/slots/duplicate
 *   認証: セッション認証
 *   Body: {
 *     sourceSlotId: string,
 *     deliveryDate?: "YYYY-MM-DD",       // 省略時は元と同じ
 *     hourSlot?: number,                 // 省略時は元と同じ。(hourSlot, minuteSlot) は SLOT_TIMES のいずれか
 *     minuteSlot?: number,               // 0 / 30。hourSlot だけ指定された場合は 0（正時）
 *     deliveryCount?: number,             // 省略時は元と同じ
 *     searchConditionName?: string | null,
 *     deliveryCategorySmall?: string | null,
 *   }
 *
 *   元レコードの machineId / 大フラグ / 中フラグ / mediaSource はそのままコピー。
 *   スカウトNOは新規発番。
 *   RPA枠（isMachine=true）は複製不可（社員枠のみ）。
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { parseSlotDate, isValidSlotTime, slotTimesLabel } from "@/lib/scout/slot-helpers";
import { generateScoutNumber } from "@/lib/scout/scout-number";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON parse error" }, { status: 400 });
  }

  const sourceSlotId = String(body.sourceSlotId ?? "").trim();
  if (!sourceSlotId) {
    return NextResponse.json(
      { error: "sourceSlotId は必須です" },
      { status: 400 },
    );
  }

  const source = await prisma.scoutDeliverySlot.findUnique({
    where: { id: sourceSlotId },
  });
  if (!source) {
    return NextResponse.json(
      { error: `元レコードが見つかりません: ${sourceSlotId}` },
      { status: 404 },
    );
  }

  if (source.isMachine) {
    return NextResponse.json(
      { error: "RPA枠は複製できません。社員枠のみ複製可能です。" },
      { status: 400 },
    );
  }

  // 上書き項目
  let deliveryDate = source.deliveryDate;
  if (typeof body.deliveryDate === "string" && body.deliveryDate.trim()) {
    try {
      deliveryDate = parseSlotDate(body.deliveryDate.trim());
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 400 },
      );
    }
  }

  let hourSlot = source.hourSlot;
  let minuteSlot = source.minuteSlot;
  if (body.hourSlot !== undefined || body.minuteSlot !== undefined) {
    hourSlot = body.hourSlot !== undefined ? Number(body.hourSlot) : source.hourSlot;
    // hourSlot だけを送る旧クライアントは「正時」を意図しているとみなし minute=0
    minuteSlot =
      body.minuteSlot !== undefined && body.minuteSlot !== null
        ? Number(body.minuteSlot)
        : body.hourSlot !== undefined
          ? 0
          : source.minuteSlot;
    if (!isValidSlotTime(hourSlot, minuteSlot)) {
      return NextResponse.json(
        { error: `配信時間（hourSlot/minuteSlot）が不正です。指定できる枠: ${slotTimesLabel()}` },
        { status: 400 },
      );
    }
  }

  let deliveryCount = source.deliveryCount;
  if (body.deliveryCount !== undefined) {
    const v = Number(body.deliveryCount);
    if (!Number.isFinite(v) || v < 0) {
      return NextResponse.json(
        { error: "deliveryCount は 0 以上の数値で指定してください" },
        { status: 400 },
      );
    }
    deliveryCount = Math.trunc(v);
  }

  const searchConditionName =
    body.searchConditionName !== undefined
      ? typeof body.searchConditionName === "string"
        ? body.searchConditionName.trim() || null
        : null
      : source.searchConditionName;

  const deliveryCategorySmall =
    body.deliveryCategorySmall !== undefined
      ? typeof body.deliveryCategorySmall === "string"
        ? body.deliveryCategorySmall.trim() || null
        : null
      : source.deliveryCategorySmall;

  try {
    const scoutNumber = await generateScoutNumber();
    const slot = await prisma.scoutDeliverySlot.create({
      data: {
        scoutNumber,
        deliveryDate,
        hourSlot,
        minuteSlot,
        machineId: source.machineId,
        isMachine: source.isMachine,
        isStaff: source.isStaff,
        deliveryCategoryLarge: source.deliveryCategoryLarge,
        deliveryCategoryMedium: source.deliveryCategoryMedium,
        deliveryCategorySmall,
        searchConditionName,
        mediaSource: source.mediaSource,
        deliveryCount,
        isAggregationTarget: true,
        memo: source.memo,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    return NextResponse.json({ slot });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint") || msg.includes("scout_slot_unique_per_category")) {
      return NextResponse.json(
        {
          error:
            "同じ条件（日付・時間・担当者・大中フラグ）の枠が既に存在します。",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
