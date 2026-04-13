import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const { entryIds } = body as { entryIds?: string[] };

  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    return NextResponse.json({ error: "entryIds is required" }, { status: 400 });
  }

  const result = await prisma.jobEntry.updateMany({
    where: { id: { in: entryIds } },
    data: { archivedAt: new Date() },
  });

  return NextResponse.json({ archived: result.count });
}
