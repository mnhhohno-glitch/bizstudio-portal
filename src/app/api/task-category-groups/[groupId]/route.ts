import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { reorderCategoriesInGroup } from "@/lib/reorder-categories";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { groupId } = await params;
    const body = await request.json();
    const { name, sortOrder } = body;

    // バリデーション
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) {
        return NextResponse.json({ error: "グループ名は必須です" }, { status: 400 });
      }
      // 重複チェック（自分以外）
      const dup = await prisma.taskCategoryGroup.findFirst({
        where: { name: trimmed, id: { not: groupId } },
      });
      if (dup) {
        return NextResponse.json({ error: "同じ名前のグループが既に存在します" }, { status: 400 });
      }
    }

    const group = await prisma.taskCategoryGroup.update({
      where: { id: groupId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    });

    return NextResponse.json({ group });
  } catch {
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { groupId } = await params;

    // グループ内のカテゴリを未分類に移動
    await prisma.taskCategory.updateMany({
      where: { groupId },
      data: { groupId: null },
    });

    await prisma.taskCategoryGroup.delete({ where: { id: groupId } });

    // 未分類グループの連番を振り直す
    await reorderCategoriesInGroup(null);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
