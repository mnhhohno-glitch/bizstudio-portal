/**
 * GET /api/scout/slots?date=YYYY-MM-DD
 *   指定日の配信枠を全件返す（RPA含む全枠）
 *
 * PATCH /api/scout/slots
 *   body: { id, deliveryCount?, deliveryCategoryLarge?, deliveryCategoryMedium?,
 *           deliveryCategorySmall?, mediaSource?, searchConditionName?, memo?,
 *           isAggregationTarget? }
 *   社員枠の手入力に使う
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { parseSlotDate } from "@/lib/scout/slot-helpers";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get("date");
  if (!dateStr) {
    return NextResponse.json({ error: "date は必須です" }, { status: 400 });
  }

  try {
    const date = parseSlotDate(dateStr);
    const slots = await prisma.scoutDeliverySlot.findMany({
      where: { deliveryDate: date },
      include: { machine: true },
      orderBy: [{ hourSlot: "asc" }],
    });
    return NextResponse.json({ slots });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  try {
    const body = await req.json();
    if (!body?.id) {
      return NextResponse.json({ error: "id は必須です" }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (body.deliveryCount !== undefined) data.deliveryCount = parseInt(String(body.deliveryCount), 10) || 0;
    if (body.openCount !== undefined) data.openCount = parseInt(String(body.openCount), 10) || 0;
    if (body.deliveryCategoryLarge !== undefined) data.deliveryCategoryLarge = body.deliveryCategoryLarge;
    if (body.deliveryCategoryMedium !== undefined) data.deliveryCategoryMedium = body.deliveryCategoryMedium || null;
    if (body.deliveryCategorySmall !== undefined) data.deliveryCategorySmall = body.deliveryCategorySmall || null;
    if (body.mediaSource !== undefined) data.mediaSource = body.mediaSource;
    if (body.searchConditionName !== undefined) data.searchConditionName = body.searchConditionName || null;
    if (body.memo !== undefined) data.memo = body.memo || null;
    if (body.isAggregationTarget !== undefined) data.isAggregationTarget = !!body.isAggregationTarget;
    data.updatedById = user.id;

    const slot = await prisma.scoutDeliverySlot.update({
      where: { id: body.id },
      data,
    });
    return NextResponse.json({ slot });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
