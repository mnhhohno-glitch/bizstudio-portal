// T-159: 新着ポップアップ用。最新の公開済みお知らせ 1 件だけを軽量に返す。
// 既存 /api/announcements/recent は本文（content）や author まで返すため、
// 全画面のレイアウトから毎回叩く用途には重い。ここでは id/title/publishedAt のみ。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const announcement = await prisma.announcement.findFirst({
    where: { status: "PUBLISHED", publishedAt: { not: null } },
    orderBy: { publishedAt: "desc" },
    select: { id: true, title: true, publishedAt: true },
  });

  return NextResponse.json({ announcement: announcement ?? null });
}
