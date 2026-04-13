import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalApiKey } from "@/lib/internal-auth";

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dry_run") === "true";

  // 30日前の日付を計算
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // 対象抽出: archivedAt が30日以上前のレコード
  const targets = await prisma.jobEntry.findMany({
    where: {
      archivedAt: { lte: thirtyDaysAgo, not: null },
    },
    select: {
      id: true,
      companyName: true,
      archivedAt: true,
      candidate: { select: { name: true, candidateNumber: true } },
    },
  });

  const totalChecked = targets.length;

  for (const t of targets) {
    console.log(
      `[AUTO-PURGE] ${dryRun ? "[DRY-RUN] " : ""}Entry ${t.id} | ${t.candidate.name} (${t.candidate.candidateNumber}) | ${t.companyName} | archivedAt=${t.archivedAt?.toISOString()}`
    );
  }

  let purged = 0;
  if (!dryRun && targets.length > 0) {
    const result = await prisma.jobEntry.deleteMany({
      where: { id: { in: targets.map((t) => t.id) } },
    });
    purged = result.count;
  } else if (dryRun) {
    purged = targets.length;
  }

  return NextResponse.json({
    purged,
    total_checked: totalChecked,
    dry_run: dryRun,
    timestamp: new Date().toISOString(),
  });
}
