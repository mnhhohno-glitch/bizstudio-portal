import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { taskId } = await params;
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        category: { select: { name: true } },
        candidate: { select: { name: true, candidateNumber: true } },
        createdByUser: { select: { name: true } },
        assignees: {
          include: { employee: { select: { name: true } } },
        },
        fieldValues: {
          include: { field: { select: { label: true, fieldType: true } } },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "タスクが見つかりません" }, { status: 404 });
    }

    return NextResponse.json({ task });
  } catch {
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
