import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");

  const where: Prisma.CandidateFileWhereInput = { candidateId };
  if (category) {
    where.category = category as Prisma.EnumCandidateFileCategoryFilter;
  }

  const files = await prisma.candidateFile.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { uploadedBy: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ files });
}
