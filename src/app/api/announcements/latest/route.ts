// T-159: 新着ポップアップ用。直近の公開済みお知らせを軽量に返す。
// 既存 /api/announcements/recent は本文（content）や author まで返すため、
// 全画面のレイアウトから毎回叩く用途には重い。ここでは id/title/category/publishedAt のみ。
//
// 「公開日〜翌営業日」の表示期間判定はクライアント側の純粋関数
// （src/lib/announcements/display-period.ts）で行うため、
// ここでは期間判定に十分な件数だけを新しい順で返す。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// 表示期間は最長でも数日なので、新しい順に少数取れば足りる（連休や連投を考慮して余裕を持たせる）
const FETCH_LIMIT = 20;

export async function GET() {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const announcements = await prisma.announcement.findMany({
    where: { status: "PUBLISHED", publishedAt: { not: null } },
    orderBy: { publishedAt: "desc" },
    take: FETCH_LIMIT,
    select: { id: true, title: true, category: true, publishedAt: true },
  });

  return NextResponse.json({ announcements });
}
