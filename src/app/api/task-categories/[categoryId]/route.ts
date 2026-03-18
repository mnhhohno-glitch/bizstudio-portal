import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { reorderCategoriesInGroup } from "@/lib/reorder-categories";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ categoryId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { categoryId } = await params;
    const body = await request.json();
    const { name, description, sortOrder, isActive, groupId } = body;

    // 変更前のグループを取得
    const before = await prisma.taskCategory.findUnique({
      where: { id: categoryId },
      select: { groupId: true },
    });
    if (!before) {
      return NextResponse.json({ error: "カテゴリが見つかりません" }, { status: 404 });
    }

    const category = await prisma.taskCategory.update({
      where: { id: categoryId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive }),
        ...(groupId !== undefined && { groupId: groupId || null }),
      },
    });

    // グループ変更時: 移動元・移動先の両方を振り直す
    if (groupId !== undefined && (groupId || null) !== before.groupId) {
      await reorderCategoriesInGroup(before.groupId);
      await reorderCategoriesInGroup(groupId || null);
    } else if (sortOrder !== undefined) {
      // 同一グループ内での並び順変更
      await reorderCategoriesInGroup(category.groupId);
    }

    return NextResponse.json({ category });
  } catch {
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ categoryId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { categoryId } = await params;

    // 削除前にグループを取得
    const cat = await prisma.taskCategory.findUnique({
      where: { id: categoryId },
      select: { groupId: true },
    });

    await prisma.taskCategory.delete({ where: { id: categoryId } });

    // 削除されたカテゴリのグループ内を振り直す
    if (cat) {
      await reorderCategoriesInGroup(cat.groupId);
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
