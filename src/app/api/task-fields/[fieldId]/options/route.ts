import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ fieldId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { fieldId } = await params;
    const body = await request.json();
    const { label, value, sortOrder } = body;

    if (!label?.trim() || !value?.trim()) {
      return NextResponse.json({ error: "ラベルと値は必須です" }, { status: 400 });
    }

    const option = await prisma.taskTemplateOption.create({
      data: {
        fieldId,
        label: label.trim(),
        value: value.trim(),
        sortOrder: sortOrder ?? 0,
      },
    });

    return NextResponse.json({ option }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
  }
}
