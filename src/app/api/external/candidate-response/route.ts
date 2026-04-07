import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const secret = request.headers.get("x-api-secret");
  const expectedSecret = process.env.KYUUJIN_API_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { candidateId, jobId, response, respondedAt } = body as {
    candidateId: string;
    jobId: number;
    response: string;
    respondedAt: string;
  };

  if (!candidateId || !jobId || !response) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const validResponses = ["WANT_TO_APPLY", "INTERESTED"];
  if (!validResponses.includes(response)) {
    return NextResponse.json({ error: "Invalid response value" }, { status: 400 });
  }

  // candidateIdがcuidかcandidateNumberかを判定
  const candidate = await prisma.candidate.findFirst({
    where: candidateId.startsWith("cm")
      ? { id: candidateId }
      : { candidateNumber: candidateId },
    select: { id: true },
  });

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  await prisma.candidateJobResponse.upsert({
    where: {
      candidateId_externalJobId: {
        candidateId: candidate.id,
        externalJobId: jobId,
      },
    },
    create: {
      candidateId: candidate.id,
      externalJobId: jobId,
      response,
      respondedAt: respondedAt ? new Date(respondedAt) : new Date(),
    },
    update: {
      response,
      respondedAt: respondedAt ? new Date(respondedAt) : new Date(),
    },
  });

  return NextResponse.json({ success: true, updated: true });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-secret",
    },
  });
}
