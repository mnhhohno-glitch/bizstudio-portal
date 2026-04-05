import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const secret = process.env.KYUUJIN_API_SECRET;
  if (!secret) {
    return NextResponse.json({ url: null });
  }

  const { candidateId } = await params;

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { candidateNumber: true },
  });

  if (!candidate) {
    return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
  }

  try {
    const res = await fetch(
      `https://web-production-95808.up.railway.app/api/external/mypage/by-job-seeker/${candidate.candidateNumber}`,
      {
        headers: { "x-api-secret": secret },
        next: { revalidate: 0 },
      }
    );

    if (!res.ok) {
      return NextResponse.json({ url: null });
    }

    const data = await res.json();
    return NextResponse.json({
      url: data.url ?? null,
      isActive: data.is_active ?? false,
      accessCount: data.access_count ?? null,
      expiresAt: data.expires_at ?? null,
    });
  } catch {
    return NextResponse.json({ url: null });
  }
}
