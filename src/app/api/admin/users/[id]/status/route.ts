import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const status = body?.status;
  
  if (status !== "active" && status !== "disabled") {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }

  const { id } = await params;

  const target = await prisma.user.update({
    where: { id },
    data: { status },
    select: { id: true, email: true, status: true },
  });

  await writeAudit({
    actorUserId: actor.id,
    action: "USER_STATUS_CHANGED",
    targetType: "USER",
    targetId: target.id,
    metadata: { email: target.email, status: target.status },
  });

  return NextResponse.json({ ok: true, user: target });
}
