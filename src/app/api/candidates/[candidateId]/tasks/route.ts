import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { candidateId } = await params;
  const { searchParams } = new URL(req.url);
  const includeCompleted = searchParams.get("includeCompleted") === "true";

  const where: Prisma.TaskWhereInput = { candidateId };
  if (!includeCompleted) {
    where.status = { not: "COMPLETED" };
  }

  const tasks = await prisma.task.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      category: { select: { id: true, name: true } },
      createdByUser: { select: { name: true } },
      assignees: {
        include: { employee: { select: { name: true } } },
      },
    },
  });

  return NextResponse.json({ tasks });
}
