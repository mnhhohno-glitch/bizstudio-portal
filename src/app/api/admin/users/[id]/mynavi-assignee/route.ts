import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { isMynaviAssignee } = await request.json();

  if (typeof isMynaviAssignee !== "boolean") {
    return NextResponse.json({ error: "isMynaviAssignee は boolean で指定してください" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id },
    data: { isMynaviAssignee },
  });

  return NextResponse.json({ success: true, userId: id, isMynaviAssignee });
}
