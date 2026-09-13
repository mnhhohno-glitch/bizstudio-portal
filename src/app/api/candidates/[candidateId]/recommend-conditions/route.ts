import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { isAutoRecommendAdmin } from "@/lib/auto-recommend-admin";
import { fetchCandidateConditions } from "@/lib/recommend/job-platform-conditions";

// T-189 追加: 求職者詳細に出す「配信条件（パターン）」の読み出し。
//
// GET /api/candidates/[candidateId]/recommend-conditions
//   - 認証: getSessionUser() ＋ isAutoRecommendAdmin（自動配信トグルと同じ権限。他は403）。
//   - job-platform の internal GET を中継するだけ（内部鍵をブラウザに出さないための一枚）。
//   - 200 { patterns: [...], enabledCount }   … 0件でも 200（patterns: [], enabledCount: 0）
//   - 502 { error: "job_platform_unreachable" } … 求人サイトに聞けなかった（＝不明）
//
// 画面はこの enabledCount で「自動配信 ON にできるか」を先に判定する（サーバー側の最終ガードは
// /api/candidates/[id]/update にある。ここは表示と事前判定のためのもの）。

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  if (!isAutoRecommendAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { candidateId } = await params;
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { candidateNumber: true },
  });
  if (!candidate) {
    return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
  }

  const result = await fetchCandidateConditions({ candidateNumber: candidate.candidateNumber });
  if (!result.ok) {
    console.error(
      `[recommend-conditions] 取得失敗 candidate=${candidate.candidateNumber} status=${result.status}: ${result.error}`,
    );
    return NextResponse.json(
      { error: "job_platform_unreachable", detail: result.error },
      { status: 502 },
    );
  }

  return NextResponse.json({
    candidateNumber: candidate.candidateNumber,
    patterns: result.patterns,
    enabledCount: result.enabledCount,
  });
}
