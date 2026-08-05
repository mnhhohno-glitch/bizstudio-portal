import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

// 1回分の詳細（設問ごとの正誤）: 本人 or admin のみ
export async function GET(_request: NextRequest, context: RouteContext) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const attempt = await prisma.trainingQuizAttempt.findUnique({
    where: { id },
    include: {
      answers: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          qid: true,
          category: true,
          questionText: true,
          chosenText: true,
          correctText: true,
          isCorrect: true,
          position: true,
        },
      },
    },
  });

  if (!attempt) {
    return NextResponse.json({ error: "記録が見つかりません" }, { status: 404 });
  }

  if (actor.role !== "admin" && attempt.userId !== actor.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({ attempt });
}
