import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { chatId } = await params;
  const chat = await prisma.rpaErrorChat.findUnique({
    where: { id: chatId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      errorLog: { select: { id: true } },
    },
  });

  if (!chat) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ chat });
}
