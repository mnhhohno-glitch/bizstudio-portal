import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const announcement = await prisma.announcement.findUnique({
    where: { id, status: "PUBLISHED" },
    include: {
      author: {
        select: { name: true },
      },
    },
  });

  if (!announcement) {
    return NextResponse.json({ error: "お知らせが見つかりません" }, { status: 404 });
  }

  return NextResponse.json(announcement);
}
