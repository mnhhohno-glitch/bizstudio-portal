import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

/**
 * GET /api/rpa-error/executions/[batchId]
 * RPA 実行バッチ詳細（処理ログ込み）。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { batchId } = await params;

  const batch = await prisma.rpaExecutionBatch.findUnique({
    where: { id: batchId },
    include: {
      processingLogs: {
        orderBy: { processedAt: "asc" },
        include: {
          candidate: { select: { id: true, candidateNumber: true, name: true } },
        },
      },
    },
  });

  if (!batch) {
    return NextResponse.json({ error: "バッチが見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ batch });
}
