import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rpa/mynavi/last-execution
 * PAD の GetOutlook 新フローで使用。最新の成功バッチ(COMPLETED)の startedAt を返す。
 * レコードが無い場合（初回起動）は null を返し、PAD 側で24時間前にフォールバックする。
 */
export async function GET(req: Request) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const last = await prisma.rpaExecutionBatch.findFirst({
    where: { status: "COMPLETED" },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });

  return NextResponse.json({ lastStartedAt: last?.startedAt ?? null });
}
