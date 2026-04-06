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
    select: { candidateNumber: true },
  });

  if (!candidate) {
    return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
  }

  if (!candidate.candidateNumber) {
    return NextResponse.json({ error: "求職者番号が設定されていません" }, { status: 400 });
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

  // 外部API（kyuujin-pdf-tool）を呼び出して削除
  const baseUrl = process.env.KYUUJIN_PDF_TOOL_URL;
  if (!baseUrl) {
    return NextResponse.json(
      { error: "KYUUJIN_PDF_TOOL_URL is not configured" },
      { status: 500 }
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(
      `${baseUrl}/api/projects/by-job-seeker-id/${candidate.candidateNumber}/jobs`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_ids: deletableIds }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.error("kyuujin-pdf-tool delete failed:", res.status, errorText);
      return NextResponse.json(
        { error: "求人の削除に失敗しました" },
        { status: 502 }
      );
    }

    const data = await res.json().catch(() => ({}));
    const deletedCount = data.deleted_count ?? deletableIds.length;

    return NextResponse.json({
      deleted_count: deletedCount,
      skipped_count: skippedCount,
      message: skippedCount > 0
        ? `${deletedCount}件の求人を削除しました（${skippedCount}件はエントリー済みのためスキップ）`
        : `${deletedCount}件の求人を紹介リストから削除しました`,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return NextResponse.json(
        { error: "kyuujin-pdf-tool APIがタイムアウトしました" },
        { status: 502 }
      );
    }
    console.error("Job introduction delete error:", error);
    return NextResponse.json(
      { error: "削除処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
