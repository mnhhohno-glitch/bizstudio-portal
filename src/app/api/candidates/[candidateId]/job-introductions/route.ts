import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ candidateId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId } = await context.params;

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, candidateNumber: true },
  });

  if (!candidate) {
    return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
  }

  const body = await request.json();
  const { job_ids } = body as { job_ids: number[] };

  if (!job_ids || !Array.isArray(job_ids) || job_ids.length === 0) {
    return NextResponse.json({ error: "削除する求人IDが指定されていません" }, { status: 400 });
  }

  // エントリー済みの求人を除外
  const enteredEntries = await prisma.jobEntry.findMany({
    where: {
      candidateId,
      externalJobId: { in: job_ids },
    },
    select: { externalJobId: true },
  });
  const enteredJobIds = new Set(enteredEntries.map((e) => e.externalJobId));
  const deletableIds = job_ids.filter((id) => !enteredJobIds.has(id));
  const skippedCount = job_ids.length - deletableIds.length;

  if (deletableIds.length === 0) {
    return NextResponse.json({
      deleted_count: 0,
      skipped_count: skippedCount,
      message: "エントリー済みの求人のため削除できませんでした",
    });
  }

  try {
    // ローカルDBに非表示レコードを作成（既存は skipDuplicates で無視）
    await prisma.hiddenJobIntroduction.createMany({
      data: deletableIds.map((externalJobId) => ({
        candidateId,
        externalJobId,
        hiddenBy: user.id,
      })),
      skipDuplicates: true,
    });

    // kyuujinPDFに非表示リクエストを送信（マイページ連動）
    const KYUUJIN_API_URL = process.env.KYUUJIN_API_URL || "https://web-production-95808.up.railway.app";
    const KYUUJIN_API_SECRET = process.env.KYUUJIN_API_SECRET;

    if (KYUUJIN_API_SECRET && candidate.candidateNumber) {
      try {
        await fetch(`${KYUUJIN_API_URL}/api/external/jobs/hide`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-secret": KYUUJIN_API_SECRET,
          },
          body: JSON.stringify({
            job_ids: deletableIds,
            job_seeker_id: candidate.candidateNumber,
          }),
        });
      } catch (error) {
        // kyuujinPDF連携が失敗してもポータル側の削除は成功させる
        console.error("[KYUUJIN] Failed to hide jobs:", error);
      }
    }

    return NextResponse.json({
      deleted_count: deletableIds.length,
      skipped_count: skippedCount,
      message: skippedCount > 0
        ? `${deletableIds.length}件の求人を削除しました（${skippedCount}件はエントリー済みのためスキップ）`
        : `${deletableIds.length}件の求人を紹介リストから削除しました`,
    });
  } catch (error) {
    console.error("Job introduction hide error:", error);
    return NextResponse.json(
      { error: "削除処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
