import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ middleId: string }> }
) {
  try {
    const { middleId } = await params;
    const minors = await prisma.jobCategoryMinor.findMany({
      where: { middleId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, sortOrder: true },
    });
    return NextResponse.json(minors);
  } catch {
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
