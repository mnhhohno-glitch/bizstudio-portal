import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const majors = await prisma.areaCategoryMajor.findMany({
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, sortOrder: true },
  });
  return NextResponse.json(majors);
}
