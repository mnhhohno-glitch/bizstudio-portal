import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const { taskIds } = body as { taskIds: string[] };

  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return NextResponse.json({ error: "taskIds is required" }, { status: 400 });
  }

  await Promise.all(
    taskIds.map((id, index) =>
      prisma.task.update({
        where: { id },
        data: { manualSortOrder: index + 1 },
      })
    )
  );

  return NextResponse.json({ ok: true });
}
