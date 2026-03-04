import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  const existing = await prisma.document.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "資料が見つかりません" }, { status: 404 });
  }

  await prisma.document.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      actorUserId: actor.id,
      action: "DOCUMENT_DELETE",
      targetType: "DOCUMENT",
      targetId: id,
      metadata: { title: existing.title },
    },
  });

  return NextResponse.json({ success: true });
}
