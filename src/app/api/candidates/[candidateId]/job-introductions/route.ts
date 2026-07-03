import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { stripFileMetadata } from "@/lib/normalize-filename";

type RouteContext = { params: Promise<{ candidateId: string }> };

// restore-jobs と同一の kyuujin 会社名正規化（挙動を一致させる）。
function normalizeKyuujinCompanyName(name: string): string {
  return name
    .replace(/_\d{14,}$/, "")
    .replace(/[：:]\d+$/, "")
    .trim();
}

// T-128 Phase2: 対象外化した求人に対応するブックマーク(CandidateFile BOOKMARK)を
// アーカイブする（お気に入りGETから消える。物理削除しない）。
// 安全ガード: 「除外後も同一正規化名のアクティブ求人が残る会社」はアーカイブしない
//   （重複導入で片方だけ除外されたケースで、生きている求人のブックマークを消さないため）。
// best-effort: 例外は握り潰し、除外処理本体（既に成功済み）を失敗させない。
async function archiveBookmarksForExcludedJobs(
  candidateId: string,
  candidateNumber: string | null,
  excludedJobIds: number[],
  userId: string,
): Promise<void> {
  if (!candidateNumber || excludedJobIds.length === 0) return;

  const baseUrl = process.env.KYUUJIN_PDF_TOOL_URL || process.env.KYUUJIN_API_URL;
  if (!baseUrl) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `${baseUrl}/api/projects/by-job-seeker-id/${candidateNumber}/jobs`,
      { signal: controller.signal },
    ).finally(() => clearTimeout(timeout));
    if (!res.ok) return;

    const data = await res.json();
    const jobs: { id: number; company_name?: string; feedback_status?: string }[] =
      data.jobs || [];

    const excludedIdSet = new Set(excludedJobIds);
    // 今回除外する求人の正規化名
    const excludedNames = new Set(
      jobs
        .filter((j) => excludedIdSet.has(j.id) && j.company_name)
        .map((j) => normalizeKyuujinCompanyName(j.company_name!)),
    );
    if (excludedNames.size === 0) return;

    // 除外後も生存するアクティブ求人（EXCLUDED でなく、今回除外対象でもない）の正規化名
    const remainingActiveNames = new Set(
      jobs
        .filter(
          (j) =>
            !excludedIdSet.has(j.id) &&
            (j.feedback_status || "UNANSWERED") !== "EXCLUDED" &&
            j.company_name,
        )
        .map((j) => normalizeKyuujinCompanyName(j.company_name!)),
    );

    // アーカイブ対象名 = 除外名のうち、生存アクティブ名に含まれないもの
    const archiveTargetNames = new Set(
      [...excludedNames].filter((n) => !remainingActiveNames.has(n)),
    );
    if (archiveTargetNames.size === 0) return;

    const bookmarks = await prisma.candidateFile.findMany({
      where: { candidateId, category: "BOOKMARK", archivedAt: null },
      select: { id: true, fileName: true },
    });

    const toArchive = bookmarks
      .filter((b) => archiveTargetNames.has(stripFileMetadata(b.fileName)))
      .map((b) => b.id);

    if (toArchive.length === 0) return;

    await prisma.candidateFile.updateMany({
      where: { id: { in: toArchive } },
      data: {
        archivedAt: new Date(),
        archivedReason: "job-excluded-sync",
        archivedById: userId,
      },
    });
    console.log(
      `[job-introductions] archived ${toArchive.length} bookmark(s) for excluded jobs candidate=${candidateId}`,
    );
  } catch (e) {
    console.error("[job-introductions] bookmark archive (best-effort) failed:", e);
  }
}

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

    // kyuujinPDFに feedback-status 更新を送信（マイページ連動）
    const KYUUJIN_API_URL = process.env.KYUUJIN_API_URL || "https://web-production-95808.up.railway.app";
    const KYUUJIN_API_SECRET = process.env.KYUUJIN_API_SECRET;

    if (KYUUJIN_API_SECRET && candidate.candidateNumber) {
      const hideResponse = await fetch(`${KYUUJIN_API_URL}/api/external/mypage/jobs/feedback-status`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-secret": KYUUJIN_API_SECRET,
        },
        body: JSON.stringify({
          job_ids: deletableIds,
          status: "EXCLUDED",
          actor: "ca",
          job_seeker_id: candidate.candidateNumber,
        }),
      });

      if (!hideResponse.ok) {
        const errorText = await hideResponse.text().catch(() => "");
        console.error("[KYUUJIN] Failed to update feedback status:", hideResponse.status, errorText);
        return NextResponse.json({ error: "求人の非表示に失敗しました" }, { status: 500 });
      }
    }

    // T-128 Phase2: 対象外化に対応するブックマークを best-effort でアーカイブ（お気に入りから除去）。
    // 失敗しても除外自体は成功として返す（await するが例外は内部で握り潰す）。
    await archiveBookmarksForExcludedJobs(
      candidateId,
      candidate.candidateNumber,
      deletableIds,
      user.id,
    );

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
