import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

// 項目の更新: admin のみ
export async function PATCH(request: NextRequest, context: RouteContext) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  const existing = await prisma.trainingCheckItem.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "項目が見つかりません" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });
  }

  const { dayLabel, label, sortOrder, isActive } = body;

  const updateData: {
    dayLabel?: string;
    label?: string;
    sortOrder?: number;
    isActive?: boolean;
  } = {};

  if (dayLabel !== undefined) {
    if (typeof dayLabel !== "string" || dayLabel.trim().length === 0) {
      return NextResponse.json({ error: "研修日（dayLabel）は必須です" }, { status: 400 });
    }
    updateData.dayLabel = dayLabel.trim();
  }
  if (label !== undefined) {
    if (typeof label !== "string" || label.trim().length === 0) {
      return NextResponse.json({ error: "項目名は必須です" }, { status: 400 });
    }
    updateData.label = label.trim();
  }
  if (sortOrder !== undefined) {
    if (typeof sortOrder !== "number" || !Number.isFinite(sortOrder)) {
      return NextResponse.json({ error: "表示順は数値で入力してください" }, { status: 400 });
    }
    updateData.sortOrder = Math.trunc(sortOrder);
  }
  if (isActive !== undefined) {
    if (typeof isActive !== "boolean") {
      return NextResponse.json({ error: "isActive の形式が不正です" }, { status: 400 });
    }
    updateData.isActive = isActive;
  }

  const item = await prisma.trainingCheckItem.update({ where: { id }, data: updateData });

  return NextResponse.json(item);
}

// 項目の削除: admin のみ（過去の回答は itemLabel を非正規化保存しているため表示は壊れない）
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  const existing = await prisma.trainingCheckItem.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "項目が見つかりません" }, { status: 404 });
  }

  await prisma.trainingCheckItem.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
