import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const errors = await prisma.rpaKnownError.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { errorLogs: true } } },
  });

  return NextResponse.json({ errors });
}

export async function POST(req: Request) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { patternName, keywords, solution, solutionUrl, severity } = await req.json();

  if (!patternName || !keywords?.length || !solution || !severity) {
    return NextResponse.json({ error: "必須項目が不足しています" }, { status: 400 });
  }

  const error = await prisma.rpaKnownError.create({
    data: { patternName, keywords, solution, solutionUrl: solutionUrl || null, severity },
  });

  return NextResponse.json({ error }, { status: 201 });
}
