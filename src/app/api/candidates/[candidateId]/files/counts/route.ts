import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;

  const grouped = await prisma.candidateFile.groupBy({
    by: ["category"],
    where: { candidateId },
    _count: { id: true },
  });

  const counts: Record<string, number> = {
    ORIGINAL: 0,
    JOB_POSTING: 0,
    BS_DOCUMENT: 0,
    APPLICATION: 0,
    INTERVIEW_PREP: 0,
    MEETING: 0,
  };

  for (const g of grouped) {
    counts[g.category] = g._count.id;
  }

  return NextResponse.json({ counts });
}
