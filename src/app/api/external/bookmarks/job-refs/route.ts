import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/external/bookmarks/job-refs?onlyMissing=true
 * T-196: 埋め戻し（POST /api/external/bookmarks/job-attributes）の対象求人IDを job-platform に渡す。
 *
 * - 認証: x-api-secret（JOB_PLATFORM_API_SECRET）。from-job-platform と同一。
 * - category="BOOKMARK" の externalJobRef を distinct で返す（archivedAt 問わず）。
 * - onlyMissing=true のときは jobArea と jobCategory が **両方 null** の行に限定する
 *   （どちらか埋まっていれば取得済みとみなす）。
 *
 * res: { refs: string[]; count: number }
 */

export async function GET(request: Request) {
  const secret = request.headers.get("x-api-secret");
  const expectedSecret = process.env.JOB_PLATFORM_API_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const onlyMissing = searchParams.get("onlyMissing") === "true";

  const rows = await prisma.candidateFile.findMany({
    where: {
      category: "BOOKMARK",
      externalJobRef: { not: null },
      ...(onlyMissing ? { jobArea: null, jobCategory: null } : {}),
    },
    distinct: ["externalJobRef"],
    select: { externalJobRef: true },
    orderBy: { externalJobRef: "asc" },
  });

  const refs = rows.map((r) => r.externalJobRef).filter((r): r is string => !!r);
  return NextResponse.json({ refs, count: refs.length });
}
