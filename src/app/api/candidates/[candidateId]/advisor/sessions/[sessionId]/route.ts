import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string; sessionId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { sessionId } = await params;

  await prisma.advisorChatSession.delete({ where: { id: sessionId } });

  return NextResponse.json({ success: true });
}
