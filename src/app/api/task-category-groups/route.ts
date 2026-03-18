import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const groups = await prisma.taskCategoryGroup.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { categories: true } } },
  });

  return NextResponse.json({ groups });
}

export async function POST(request: Request) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { name, sortOrder } = body;
    if (!name?.trim()) {
      return NextResponse.json({ error: "名前は必須です" }, { status: 400 });
    }

    const dup = await prisma.taskCategoryGroup.findFirst({
      where: { name: name.trim() },
    });
    if (dup) {
      return NextResponse.json({ error: "同じ名前のグループが既に存在します" }, { status: 400 });
    }

    let finalSortOrder = sortOrder;
    if (finalSortOrder === undefined || finalSortOrder === null) {
      const max = await prisma.taskCategoryGroup.aggregate({ _max: { sortOrder: true } });
      finalSortOrder = (max._max.sortOrder ?? 0) + 1;
    }

    const group = await prisma.taskCategoryGroup.create({
      data: { name: name.trim(), sortOrder: finalSortOrder },
    });

    return NextResponse.json({ group }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
  }
}
