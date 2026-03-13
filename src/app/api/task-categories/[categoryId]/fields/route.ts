import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ categoryId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { categoryId } = await params;

  const category = await prisma.taskCategory.findUnique({
    where: { id: categoryId },
  });
  if (!category) {
    return NextResponse.json({ error: "カテゴリが見つかりません" }, { status: 404 });
  }

  const fields = await prisma.taskTemplateField.findMany({
    where: { categoryId },
    orderBy: { sortOrder: "asc" },
    include: {
      options: { orderBy: { sortOrder: "asc" } },
    },
  });

  return NextResponse.json({ category, fields });
}

export async function POST(
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
    const { label, fieldType, isRequired, placeholder, sortOrder } = body;

    if (!label?.trim() || !fieldType) {
      return NextResponse.json({ error: "ラベルと項目タイプは必須です" }, { status: 400 });
    }

    const field = await prisma.taskTemplateField.create({
      data: {
        categoryId,
        label: label.trim(),
        fieldType,
        isRequired: isRequired ?? false,
        placeholder: placeholder?.trim() || null,
        sortOrder: sortOrder ?? 0,
      },
      include: { options: true },
    });

    return NextResponse.json({ field }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
  }
}
