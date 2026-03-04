import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { id } = await context.params;

  const document = await prisma.document.findUnique({
    where: { id, status: "PUBLISHED" },
    include: {
      author: { select: { name: true } },
    },
  });

  if (!document) {
    return NextResponse.json({ error: "資料が見つかりません" }, { status: 404 });
  }

  return NextResponse.json(document);
}
