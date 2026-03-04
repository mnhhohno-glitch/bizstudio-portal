import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;

  const guideEntry = await prisma.guideEntry.findUnique({
    where: { token },
    include: {
      candidate: { select: { name: true } },
    },
  });

  if (!guideEntry) {
    return NextResponse.json({ error: "無効なトークンです" }, { status: 404 });
  }

  return NextResponse.json({
    guideEntry,
    candidate: guideEntry.candidate,
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;

  const guideEntry = await prisma.guideEntry.findUnique({
    where: { token },
  });

  if (!guideEntry) {
    return NextResponse.json({ error: "無効なトークンです" }, { status: 404 });
  }

  const body = await request.json();
  const { data } = body;

  if (!data || typeof data !== "object") {
    return NextResponse.json({ error: "dataフィールドが必要です" }, { status: 400 });
  }

  const updated = await prisma.guideEntry.update({
    where: { id: guideEntry.id },
    data: { data },
  });

  return NextResponse.json({ guideEntry: updated });
}
