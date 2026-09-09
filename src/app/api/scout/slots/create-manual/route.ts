/**
 * T-064: 配信レコードの手動新規作成 API（社員一斉配信用）
 *
 * POST /api/scout/slots/create-manual
 *   認証: セッション認証
 *   Body: {
 *     deliveryDate: "YYYY-MM-DD",
 *     hourSlot: number (8〜19),
 *     machineId: string,                       // 社員の ScoutMachineMaster.id
 *     deliveryCategoryLarge: "社員",
 *     deliveryCategoryMedium: "一斉配信" | "個別配信",
 *     deliveryCategorySmall?: "検索条件指定" | "検索条件未指定" | null,
 *     searchConditionName?: string | null,
 *     mediaSource: string,                     // 媒体名（マイナビ転職等）
 *     deliveryCount: number,
 *     memo?: string | null,
 *   }
 *
 *   スカウトNOは自動採番される。
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { parseSlotDate } from "@/lib/scout/slot-helpers";
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

  const deliveryDateStr = String(body.deliveryDate ?? "").trim();
  const hourSlot = Number(body.hourSlot);
  const machineId = String(body.machineId ?? "").trim();
  const deliveryCategoryLarge = String(body.deliveryCategoryLarge ?? "").trim();
  const deliveryCategoryMedium =
    typeof body.deliveryCategoryMedium === "string"
      ? body.deliveryCategoryMedium.trim() || null
      : null;
  const deliveryCategorySmall =
    typeof body.deliveryCategorySmall === "string"
      ? body.deliveryCategorySmall.trim() || null
      : null;
  const searchConditionName =
    typeof body.searchConditionName === "string"
      ? body.searchConditionName.trim() || null
      : null;
  const mediaSource = String(body.mediaSource ?? "マイナビ転職").trim();
  const deliveryCount = Number(body.deliveryCount ?? 0);
  const memo = typeof body.memo === "string" ? body.memo.trim() || null : null;

  if (!deliveryDateStr) {
    return NextResponse.json({ error: "deliveryDate は必須です" }, { status: 400 });
  }
  if (!Number.isInteger(hourSlot) || hourSlot < 8 || hourSlot > 19) {
    return NextResponse.json(
      { error: "hourSlot は 8〜19 の整数で指定してください" },
      { status: 400 },
    );
  }
  if (!machineId) {
    return NextResponse.json({ error: "machineId は必須です" }, { status: 400 });
  }
  if (!deliveryCategoryLarge) {
    return NextResponse.json(
      { error: "deliveryCategoryLarge は必須です" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(deliveryCount) || deliveryCount < 0) {
    return NextResponse.json(
      { error: "deliveryCount は 0 以上の数値で指定してください" },
      { status: 400 },
    );
  }

  const machine = await prisma.scoutMachineMaster.findUnique({
    where: { id: machineId },
  });
  if (!machine) {
    return NextResponse.json(
      { error: `担当者が見つかりません: ${machineId}` },
      { status: 400 },
    );
  }

  let deliveryDate: Date;
  try {
    deliveryDate = parseSlotDate(deliveryDateStr);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  try {
    const scoutNumber = await generateScoutNumber();
    const slot = await prisma.scoutDeliverySlot.create({
      data: {
        scoutNumber,
        deliveryDate,
        hourSlot,
        machineId,
        isMachine: machine.isMachine,
        isStaff: !machine.isMachine,
        deliveryCategoryLarge,
        deliveryCategoryMedium,
        deliveryCategorySmall,
        searchConditionName,
        mediaSource,
        deliveryCount: Math.trunc(deliveryCount),
        isAggregationTarget: true,
        memo,
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
            "同じ条件（日付・時間・担当者・大中フラグ）の枠が既に存在します。複製ではなく既存レコードを編集してください。",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
