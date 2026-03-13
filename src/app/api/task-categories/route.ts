import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: Request) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const includeFields = searchParams.get("includeFields") === "true";

  const categories = await prisma.taskCategory.findMany({
    where: actor.role !== "admin" ? { isActive: true } : undefined,
    orderBy: { sortOrder: "asc" },
    include: includeFields
      ? {
          fields: {
            orderBy: { sortOrder: "asc" },
            include: { options: { orderBy: { sortOrder: "asc" } } },
          },
          _count: { select: { fields: true } },
        }
      : { _count: { select: { fields: true } } },
  });

  return NextResponse.json({ categories });
}

export async function POST(request: Request) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { name, description, sortOrder } = body;
    if (!name?.trim()) {
      return NextResponse.json({ error: "名前は必須です" }, { status: 400 });
    }

    const category = await prisma.taskCategory.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        sortOrder: sortOrder ?? 0,
      },
    });

    return NextResponse.json({ category }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
  }
}
