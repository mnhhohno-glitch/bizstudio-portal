import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

/**
 * GET /api/candidates/[candidateId]/saved-jobs
 * 求職者ブックマーク連携 段階2（保存求人の取得・portal内部API）。
 * その求職者の保存求人（candidate_saved_jobs）を savedAt 降順で返す。
 * - 認証: bs_session（getSessionUser）。external 系とは別の内部API。
 * - スナップショット列のみ返却（表示時に job-platform(Supabase) を跨がない）。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { candidateId } = await params;

  const savedJobs = await prisma.candidateSavedJob.findMany({
    where: { candidateId },
    orderBy: { savedAt: "desc" },
    select: {
      id: true,
      source: true,
      externalJobRef: true,
      jobTitle: true,
      companyName: true,
      jobUrl: true,
      salaryText: true,
      note: true,
      savedAt: true,
    },
  });

  return NextResponse.json({ count: savedJobs.length, savedJobs });
}
