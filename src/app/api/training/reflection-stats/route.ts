import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// 項目別の理解度集計: admin 限定
// 「C または D（あいまい以下）」の割合が高い順に返す = 研修内容の改善対象を上に出す
export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const dayLabel = request.nextUrl.searchParams.get("dayLabel") || undefined;

  // 集計対象は項目マスタ起点（削除済み項目の回答は集計から外れるが、履歴表示は itemLabel 非正規化で残る）
  const items = await prisma.trainingCheckItem.findMany({
    where: dayLabel ? { dayLabel } : {},
    select: { id: true, dayLabel: true, label: true, sortOrder: true },
  });
  if (items.length === 0) {
    return NextResponse.json({ stats: [] });
  }

  const grouped = await prisma.trainingCheckAnswer.groupBy({
    by: ["itemId", "rating"],
    where: { itemId: { in: items.map((i) => i.id) } },
    _count: { _all: true },
  });

  const countMap = new Map<string, { A: number; B: number; C: number; D: number }>();
  for (const g of grouped) {
    const counts = countMap.get(g.itemId) ?? { A: 0, B: 0, C: 0, D: 0 };
    if (g.rating === "A" || g.rating === "B" || g.rating === "C" || g.rating === "D") {
      counts[g.rating] += g._count._all;
    }
    countMap.set(g.itemId, counts);
  }

  const stats = items
    .map((item) => {
      const counts = countMap.get(item.id) ?? { A: 0, B: 0, C: 0, D: 0 };
      const total = counts.A + counts.B + counts.C + counts.D;
      const cdCount = counts.C + counts.D;
      return {
        itemId: item.id,
        itemLabel: item.label,
        dayLabel: item.dayLabel,
        total,
        countA: counts.A,
        countB: counts.B,
        countC: counts.C,
        countD: counts.D,
        cdCount,
        cdRate: total > 0 ? cdCount / total : 0,
      };
    })
    .filter((s) => s.total > 0)
    .sort((a, b) => b.cdRate - a.cdRate || b.total - a.total);

  return NextResponse.json({ stats });
}
