import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ middleId: string }> }
) {
  const { middleId } = await params;
  const minors = await prisma.areaCategoryMinor.findMany({
    where: { middleId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, sortOrder: true },
  });
  return NextResponse.json(minors);
}
