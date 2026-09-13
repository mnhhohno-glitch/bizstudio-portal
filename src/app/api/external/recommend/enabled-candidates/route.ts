import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// T-189 Phase 2a: 自動引き当てエンジン（job-platform）向け・配信ON求職者の一覧。
//
// GET /api/external/recommend/enabled-candidates
//   認証: x-api-secret（JOB_PLATFORM_API_SECRET）。from-job-platform / candidates/search と同一。
//   対象: autoRecommendEnabled=true かつ supportStatus="ACTIVE"（支援中）のみ。
//   返却: { candidates: [{ candidateNumber, candidateId }] }
//     - candidateNumber: 求職者番号（job-history API のパスに使う）
//     - candidateId: portal の Candidate.id（from-job-platform の candidateId に使う）
//   読み出しのみ・1クエリ。トグルは求職者詳細ヘッダ（AUTO_RECOMMEND_ADMIN_IDS のユーザーのみ）。

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = request.headers.get("x-api-secret");
  const expectedSecret = process.env.JOB_PLATFORM_API_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.candidate.findMany({
    where: { autoRecommendEnabled: true, supportStatus: "ACTIVE" },
    select: { id: true, candidateNumber: true },
    orderBy: { candidateNumber: "asc" },
  });

  return NextResponse.json(
    {
      candidates: rows.map((r) => ({
        candidateNumber: r.candidateNumber,
        candidateId: r.id,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
