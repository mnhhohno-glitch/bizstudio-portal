import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { resolveEntryIsActive } from "@/lib/entries/resolveEntryIsActive";
// T-XXX step5B: 選考ステータスが変わる行だけ、同じトランザクションで履歴を追記する
import { ENTRY_STATUS_SELECT, ENTRY_STATUS_ROUTES, recordJobEntryStatusChange } from "@/lib/entry-status-history";

type UpdateItem = {
  id: string;
  entryFlagDetail: string;
  companyFlag: string;
};

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { updates } = (await req.json()) as { updates: UpdateItem[] };
  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ updatedIds: [] });
  }

  const updatedIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const u of updates) {
      // T-140: 更新後のフラグ状態で is_active を双方向再計算して一緒に保存する。
      // entryFlag / personFlag は本APIでは変更しないため既存値をマージして判定する。
      const existing = await tx.jobEntry.findUnique({
        where: { id: u.id },
        select: ENTRY_STATUS_SELECT,
      });
      const isActive = resolveEntryIsActive({
        entryFlag: existing?.entryFlag ?? null,
        entryFlagDetail: u.entryFlagDetail,
        companyFlag: u.companyFlag,
        personFlag: existing?.personFlag ?? null,
      });
      const after = await tx.jobEntry.update({
        where: { id: u.id },
        data: {
          entryFlagDetail: u.entryFlagDetail,
          companyFlag: u.companyFlag,
          isActive,
        },
        select: ENTRY_STATUS_SELECT,
      });
      if (existing) {
        await recordJobEntryStatusChange(tx, { event: "update", before: existing, after, changedByUserId: user.id, route: ENTRY_STATUS_ROUTES.autoProgress });
      }
      updatedIds.push(u.id);
    }
  });

  return NextResponse.json({ updatedIds });
}
