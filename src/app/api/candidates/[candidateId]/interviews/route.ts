import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const records = await prisma.interviewRecord.findMany({
    where: { candidateId },
    orderBy: { interviewDate: "desc" },
    include: {
      interviewer: { select: { name: true } },
      rating: { select: { overallRank: true, grandTotal: true } },
    },
  });

  return NextResponse.json({ records });
}
