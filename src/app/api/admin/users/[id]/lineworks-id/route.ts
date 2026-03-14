import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }

  const { id } = await params;
  const lineworksId = body.lineworksId?.trim() || null;

  const updated = await prisma.user.update({
    where: { id },
    data: { lineworksId },
    select: { id: true, lineworksId: true },
  });

  return NextResponse.json({ ok: true, lineworksId: updated.lineworksId });
}
