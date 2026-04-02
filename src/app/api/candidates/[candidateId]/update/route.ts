import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ candidateId: string }> };

function normalizeSpaces(str: string): string {
  return str.replace(/\u3000/g, " ");
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId } = await context.params;

  const existing = await prisma.candidate.findUnique({
    where: { id: candidateId },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "求職者が見つかりません" },
      { status: 404 }
    );
  }

  const body = await request.json();
  const updateData: Record<string, unknown> = {};

  if (body.name !== undefined) {
    updateData.name = normalizeSpaces(body.name.trim());
  }
  if (body.furigana !== undefined) {
    updateData.nameKana = normalizeSpaces(body.furigana.trim());
  }
  if (body.email !== undefined) {
    updateData.email = body.email.trim() || null;
  }
  if (body.gender !== undefined) {
    updateData.gender = body.gender || null;
  }
  if (body.assignedEmployeeId !== undefined) {
    updateData.employeeId = body.assignedEmployeeId || null;
  }
  if (body.birthday !== undefined) {
    updateData.birthday = body.birthday ? new Date(body.birthday) : null;
  }
  if (body.supportStatus !== undefined) {
    updateData.supportStatus = body.supportStatus;
  }

  const updated = await prisma.candidate.update({
    where: { id: candidateId },
    data: updateData,
    include: {
      employee: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ candidate: updated });
}
