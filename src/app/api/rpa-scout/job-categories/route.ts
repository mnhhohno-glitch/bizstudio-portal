import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// 職種マスタ（大分類→中分類→小分類の3階層絞り込みUI用）
export async function GET() {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const categories = await prisma.rpaScoutJobCategory.findMany({
    orderBy: { sortOrder: "asc" },
    select: { large: true, middle: true, small: true },
  });
  return NextResponse.json({ categories });
}
