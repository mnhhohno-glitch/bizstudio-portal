/**
 * POST /api/scout/candidates/link
 *   body: { candidateId, scoutNumber }
 *   応募者にスカウト配信枠を紐付ける
 *
 * DELETE /api/scout/candidates/link?candidateId=xxx
 *   紐付け解除
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { isValidScoutNumberFormat } from "@/lib/scout/scout-number";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  try {
    const body = await req.json();
    const candidateId = String(body?.candidateId || "").trim();
    const scoutNumber = String(body?.scoutNumber || "").trim();

    if (!candidateId) {
      return NextResponse.json({ error: "candidateId は必須です" }, { status: 400 });
    }
    if (!isValidScoutNumberFormat(scoutNumber)) {
      return NextResponse.json(
        { error: "スカウト番号フォーマットが不正です（SC + 8桁数字）" },
        { status: 400 },
      );
    }

    const slot = await prisma.scoutDeliverySlot.findUnique({
      where: { scoutNumber },
    });
    if (!slot) {
      return NextResponse.json(
        { error: `スカウト番号 ${scoutNumber} の配信枠が見つかりません` },
        { status: 404 },
      );
    }

    const candidate = await prisma.candidate.update({
      where: { id: candidateId },
      data: {
        scoutDeliverySlotId: slot.id,
        scoutNumber,
        scoutLinkedAt: new Date(),
        scoutLinkedById: user.id,
      },
    });

    return NextResponse.json({ candidate, slot });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const candidateId = searchParams.get("candidateId");
  if (!candidateId) {
    return NextResponse.json({ error: "candidateId は必須です" }, { status: 400 });
  }

  try {
    const candidate = await prisma.candidate.update({
      where: { id: candidateId },
      data: {
        scoutDeliverySlotId: null,
        scoutLinkedAt: null,
        scoutLinkedById: null,
      },
    });
    return NextResponse.json({ candidate });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
