import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["CONFIRMED"],
  CONFIRMED: ["COMPLETED"],
  COMPLETED: [],
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const { status } = body as { status: string };

  if (!status || !["DRAFT", "CONFIRMED", "COMPLETED"].includes(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const existing = await prisma.dailySchedule.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.userId !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const allowed = VALID_TRANSITIONS[existing.status] || [];
  if (!allowed.includes(status)) {
    return NextResponse.json(
      { error: `${existing.status} から ${status} への遷移は許可されていません` },
      { status: 400 }
    );
  }

  const updated = await prisma.dailySchedule.update({
    where: { id },
    data: { status: status as "DRAFT" | "CONFIRMED" | "COMPLETED" },
    include: { entries: { orderBy: { sortOrder: "asc" } } },
  });

  return NextResponse.json({ schedule: updated });
}
