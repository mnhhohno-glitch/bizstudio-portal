import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  if (q.length < 2) {
    return NextResponse.json([]);
  }

  const limit = Math.min(
    10,
    parseInt(req.nextUrl.searchParams.get("limit") || "10")
  );

  const candidates = await prisma.candidate.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { nameKana: { contains: q, mode: "insensitive" } },
        { candidateNumber: { startsWith: q } },
      ],
    },
    select: {
      id: true,
      name: true,
      candidateNumber: true,
      employee: { select: { name: true } },
    },
    orderBy: { candidateNumber: "desc" },
    take: limit,
  });

  return NextResponse.json(
    candidates.map((c) => ({
      id: c.id,
      name: c.name,
      candidateNumber: c.candidateNumber,
      careerAdvisorName: c.employee?.name || null,
    }))
  );
}
