import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "管理者権限が必要です" }, { status: 403 });
  }

  const body = await req.json();
  const { entryIds } = body as { entryIds?: string[] };

  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    return NextResponse.json({ error: "entryIds is required" }, { status: 400 });
  }

  // アーカイブ済みのレコードのみ削除可能
  const result = await prisma.jobEntry.deleteMany({
    where: {
      id: { in: entryIds },
      archivedAt: { not: null },
    },
  });

  return NextResponse.json({ deleted: result.count });
}
