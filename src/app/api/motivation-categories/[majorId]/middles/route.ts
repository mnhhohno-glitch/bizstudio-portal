import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ majorId: string }> }
) {
  try {
    const { majorId } = await params;
    const middles = await prisma.motivationCategoryMiddle.findMany({
      where: { majorId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, sortOrder: true },
    });
    return NextResponse.json(middles);
  } catch {
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
