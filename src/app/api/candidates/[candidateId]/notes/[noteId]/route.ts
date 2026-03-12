import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ candidateId: string; noteId: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId, noteId } = await context.params;

  const note = await prisma.candidateNote.findFirst({
    where: { id: noteId, candidateId },
  });

  if (!note) {
    return NextResponse.json(
      { error: "メモが見つかりません" },
      { status: 404 }
    );
  }

  if (note.authorUserId !== user.id && user.role !== "admin") {
    return NextResponse.json(
      { error: "削除権限がありません" },
      { status: 403 }
    );
  }

  await prisma.candidateNote.delete({ where: { id: noteId } });

  return NextResponse.json({ success: true });
}
