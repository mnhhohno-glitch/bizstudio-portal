import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";

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

  const where: Prisma.RpaExecutionBatchWhereInput = {};
  if (machineNumber) where.machineNumber = parseInt(machineNumber, 10);

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
