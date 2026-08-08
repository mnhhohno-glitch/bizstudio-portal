import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// 一覧: ログイン済み全員。isActive: true のみ返す（dayLabel で絞り込み可）
// admin が all=1 を付けた場合のみ isActive: false も含めて返す（項目管理モーダル用）
export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const dayLabel = sp.get("dayLabel") || undefined;
  const includeInactive = sp.get("all") === "1" && actor.role === "admin";

  const items = await prisma.trainingCheckItem.findMany({
    where: {
      ...(dayLabel ? { dayLabel } : {}),
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ dayLabel: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({ items });
}

// 項目の追加: admin のみ
export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });
  }

  const { dayLabel, label, sortOrder, isActive } = body;

  if (typeof dayLabel !== "string" || dayLabel.trim().length === 0) {
    return NextResponse.json({ error: "研修日（dayLabel）は必須です" }, { status: 400 });
  }
  if (typeof label !== "string" || label.trim().length === 0) {
    return NextResponse.json({ error: "項目名は必須です" }, { status: 400 });
  }
  if (sortOrder !== undefined && (typeof sortOrder !== "number" || !Number.isFinite(sortOrder))) {
    return NextResponse.json({ error: "表示順は数値で入力してください" }, { status: 400 });
  }
  if (isActive !== undefined && typeof isActive !== "boolean") {
    return NextResponse.json({ error: "isActive の形式が不正です" }, { status: 400 });
  }

  const item = await prisma.trainingCheckItem.create({
    data: {
      dayLabel: dayLabel.trim(),
      label: label.trim(),
      sortOrder: typeof sortOrder === "number" ? Math.trunc(sortOrder) : 0,
      isActive: isActive !== false,
    },
  });

  return NextResponse.json(item);
}
