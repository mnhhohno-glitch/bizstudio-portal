import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ majorId: string }> }
) {
  const { majorId } = await params;
  const middles = await prisma.areaCategoryMiddle.findMany({
    where: { majorId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, sortOrder: true },
  });
  return NextResponse.json(middles);
}
