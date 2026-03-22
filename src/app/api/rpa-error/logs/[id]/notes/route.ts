import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const { content } = await req.json();

  if (!content?.trim()) {
    return NextResponse.json({ error: "内容は必須です" }, { status: 400 });
  }

  const note = await prisma.rpaErrorNote.create({
    data: {
      errorLogId: id,
      content: content.trim(),
      createdBy: actor.id,
    },
    include: { user: { select: { name: true } } },
  });

  return NextResponse.json({ note }, { status: 201 });
}
