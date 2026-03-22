import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function POST() {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const chat = await prisma.rpaErrorChat.create({
    data: { userId: actor.id },
  });

  return NextResponse.json({ chatId: chat.id });
}

export async function GET() {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const chats = await prisma.rpaErrorChat.findMany({
    where: { userId: actor.id },
    orderBy: { createdAt: "desc" },
    include: {
      messages: { take: 1, orderBy: { createdAt: "asc" } },
      errorLog: { select: { id: true } },
    },
  });

  return NextResponse.json({ chats });
}
