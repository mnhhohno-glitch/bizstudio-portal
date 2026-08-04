import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// URL は「/」始まりの内部パス、または http(s):// 始まりのみ許可
// route.ts は HTTP メソッド以外を export できないためファイル内定義（../route.ts にも同一実装あり）
function isValidMaterialUrl(url: string): boolean {
  return /^\//.test(url) || /^https?:\/\//.test(url);
}

type RouteContext = { params: Promise<{ id: string }> };

// 更新: admin のみ
export async function PATCH(request: NextRequest, context: RouteContext) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  const existing = await prisma.trainingMaterial.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "教材が見つかりません" }, { status: 404 });
  }

  const body = await request.json();
  const { title, description, category, url, tag, sortOrder, isPublished } = body;

  const updateData: {
    title?: string;
    description?: string | null;
    category?: string;
    url?: string;
    tag?: string | null;
    sortOrder?: number;
    isPublished?: boolean;
  } = {};

  if (title !== undefined) {
    if (typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "タイトルは必須です" }, { status: 400 });
    }
    updateData.title = title.trim();
  }

  if (category !== undefined) {
    if (typeof category !== "string" || category.trim().length === 0) {
      return NextResponse.json({ error: "カテゴリは必須です" }, { status: 400 });
    }
    updateData.category = category.trim();
  }

  if (url !== undefined) {
    if (typeof url !== "string" || !isValidMaterialUrl(url.trim())) {
      return NextResponse.json(
        { error: "URLは / 始まりの内部パス、または http(s):// 始まりで入力してください" },
        { status: 400 }
      );
    }
    updateData.url = url.trim();
  }

  if (description !== undefined) {
    if (description !== null && typeof description !== "string") {
      return NextResponse.json({ error: "説明の形式が不正です" }, { status: 400 });
    }
    updateData.description =
      typeof description === "string" && description.trim().length > 0 ? description.trim() : null;
  }

  if (tag !== undefined) {
    if (tag !== null && typeof tag !== "string") {
      return NextResponse.json({ error: "タグの形式が不正です" }, { status: 400 });
    }
    updateData.tag = typeof tag === "string" && tag.trim().length > 0 ? tag.trim() : null;
  }

  if (sortOrder !== undefined) {
    if (typeof sortOrder !== "number" || !Number.isFinite(sortOrder)) {
      return NextResponse.json({ error: "表示順は数値で入力してください" }, { status: 400 });
    }
    updateData.sortOrder = Math.trunc(sortOrder);
  }

  if (isPublished !== undefined) {
    if (typeof isPublished !== "boolean") {
      return NextResponse.json({ error: "公開設定の形式が不正です" }, { status: 400 });
    }
    updateData.isPublished = isPublished;
  }

  const material = await prisma.trainingMaterial.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json(material);
}

// 削除: admin のみ
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  const existing = await prisma.trainingMaterial.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "教材が見つかりません" }, { status: 404 });
  }

  await prisma.trainingMaterial.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
