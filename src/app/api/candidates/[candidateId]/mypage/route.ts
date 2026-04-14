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
    console.warn("[mypage] KYUUJIN_API_SECRET is not set");
    return NextResponse.json({ url: null, debug: "no-secret" });
  }

  const { candidateId } = await params;

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { candidateNumber: true, birthday: true },
  });

  if (!candidate) {
    return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
  }

  const externalUrl = `https://web-production-95808.up.railway.app/api/external/mypage/by-job-seeker/${candidate.candidateNumber}`;
  console.log(
    `[mypage] GET candidateId=${candidateId} candidateNumber=${candidate.candidateNumber} birthday=${candidate.birthday?.toISOString() ?? "null"} url=${externalUrl}`
  );

  try {
    const res = await fetch(externalUrl, {
      headers: { "x-api-secret": secret },
      next: { revalidate: 0 },
    });

    const rawBody = await res.text();
    console.log(
      `[mypage] response status=${res.status} ok=${res.ok} body=${rawBody.slice(0, 500)}`
    );

    if (!res.ok) {
      return NextResponse.json({
        url: null,
        debug: { status: res.status, body: rawBody.slice(0, 500) },
      });
    }

    let data: { url?: string | null; is_active?: boolean; access_count?: number; expires_at?: string } = {};
    try {
      data = JSON.parse(rawBody);
    } catch (e) {
      console.error("[mypage] JSON parse failed:", e);
      return NextResponse.json({ url: null, debug: "json-parse-failed" });
    }
    const baseUrl = data.url ?? null;
    const adminUrl = baseUrl
      ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}admin=true&secret=${secret}`
      : null;
    return NextResponse.json({
      url: baseUrl,
      adminUrl,
      isActive: data.is_active ?? false,
      accessCount: data.access_count ?? null,
      expiresAt: data.expires_at ?? null,
    });
  } catch (e) {
    console.error("[mypage] fetch threw:", e);
    return NextResponse.json({ url: null, debug: "fetch-threw" });
  }
}
