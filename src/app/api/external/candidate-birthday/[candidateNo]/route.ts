import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ candidateNo: string }> }
) {
  const apiSecret = request.headers.get("x-api-secret");
  const expectedSecret = process.env.EXTERNAL_API_SECRET;

  if (!expectedSecret || apiSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { candidateNo } = await params;

  const candidate = await prisma.candidate.findUnique({
    where: { candidateNumber: candidateNo },
    select: { birthday: true, email: true },
  });

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  let birthday: string | null = null;
  if (candidate.birthday) {
    const d = candidate.birthday;
    birthday = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }

  return NextResponse.json({ birthday, email: candidate.email ?? null });
}
