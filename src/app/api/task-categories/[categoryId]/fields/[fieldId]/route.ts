import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ categoryId: string; fieldId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { fieldId } = await params;
    const body = await request.json();
    const { label, fieldType, isRequired, placeholder, description, sortOrder } = body;

    const field = await prisma.taskTemplateField.update({
      where: { id: fieldId },
      data: {
        ...(label !== undefined && { label: label.trim() }),
        ...(fieldType !== undefined && { fieldType }),
        ...(isRequired !== undefined && { isRequired }),
        ...(placeholder !== undefined && { placeholder: placeholder?.trim() || null }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
      include: { options: { orderBy: { sortOrder: "asc" } } },
    });

    return NextResponse.json({ field });
  } catch {
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ categoryId: string; fieldId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { fieldId } = await params;
    await prisma.taskTemplateField.delete({ where: { id: fieldId } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
