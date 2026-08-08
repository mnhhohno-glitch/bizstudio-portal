import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const announcements = await prisma.announcement.findMany({
    orderBy: [
      { publishedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    include: {
      author: {
        select: { name: true },
      },
      // T-156: 編集モーダルの添付一覧用（既存フィールドは不変・加算のみ）
      attachments: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, fileName: true, fileSize: true, createdAt: true },
      },
    },
  });

  return NextResponse.json({ announcements });
}
