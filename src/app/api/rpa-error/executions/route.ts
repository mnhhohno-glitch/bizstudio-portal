import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { RPA_BATCH_STATUS_NO_TARGET } from "@/lib/mynavi-rpa/no-target";

/**
 * GET /api/rpa-error/executions
 * RPA 実行履歴（バッチ）一覧。
 */
export async function GET(req: Request) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const machineNumber = searchParams.get("machineNumber");
  const skip = Math.max(0, parseInt(searchParams.get("skip") || "0", 10));
  const take = Math.min(100, Math.max(1, parseInt(searchParams.get("take") || "20", 10)));

  // T-168: 空振りバッチ（NO_TARGET）は既定で非表示。includeNoTarget=1 で表示する。
  const includeNoTarget = ["1", "true"].includes(
    (searchParams.get("includeNoTarget") || "").toLowerCase(),
  );

  const where: Prisma.RpaExecutionBatchWhereInput = {};
  if (machineNumber) where.machineNumber = parseInt(machineNumber, 10);
  if (!includeNoTarget) where.status = { not: RPA_BATCH_STATUS_NO_TARGET };

  const [items, total] = await Promise.all([
    prisma.rpaExecutionBatch.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip,
      take,
    }),
    prisma.rpaExecutionBatch.count({ where }),
  ]);

  return NextResponse.json({ items, total });
}
