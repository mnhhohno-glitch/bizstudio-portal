import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId } = await params;

  const memos = await prisma.candidateMemo.findMany({
    where: { candidateId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(memos);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId } = await params;
  const body = await req.json();

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true },
  });

  if (!candidate) {
    return NextResponse.json(
      { error: "Candidate not found" },
      { status: 404 }
    );
  }

  const memo = await prisma.candidateMemo.create({
    data: {
      candidateId,
      title: body.title || "",
      content: body.content || "",
      createdBy: body.createdBy || null,
    },
  });

  return NextResponse.json(memo, { status: 201 });
}
