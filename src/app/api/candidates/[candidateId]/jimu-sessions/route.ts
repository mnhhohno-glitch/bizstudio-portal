import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  try {
    const { candidateId } = await params;

    const sessions = await prisma.jimuSession.findMany({
      where: { candidateId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        token: true,
        candidateName: true,
        state: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
      },
    });

    return NextResponse.json({ sessions });
  } catch {
    return NextResponse.json(
      { error: "データの取得に失敗しました" },
      { status: 500 }
    );
  }
}
