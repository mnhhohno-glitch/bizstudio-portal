// T-215: 号機の稼働オン/オフ（RpaScoutMachine.isActive）を画面から切り替える内部 API。
//   これまで isActive は seed / スクリプトでしか変えられなかった。切替の影響は既存ロジックがそのまま拾う:
//   一覧の警告帯（予約切れ・有効なし）・同日の他号機パネル・重複判定・日付切替（activate.ts）・
//   朝のまとめ通知（daily-summary.ts）・外部 API（external.ts は停止中の号機を拒否する）。
//   稼働オフにしてもその号機の条件・実績は消さない（行はそのまま残り、一覧・CSV にも出る）。
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });

  const { isActive } = body as { isActive?: unknown };
  if (typeof isActive !== "boolean") return NextResponse.json({ error: "isActive は true / false で指定してください" }, { status: 400 });

  const current = await prisma.rpaScoutMachine.findUnique({ where: { id }, select: { id: true } });
  if (!current) return NextResponse.json({ error: "号機が見つかりません" }, { status: 404 });

  const updated = await prisma.rpaScoutMachine.update({
    where: { id },
    data: { isActive },
    select: { id: true, machineNo: true, isActive: true },
  });
  return NextResponse.json({ machine: updated });
}
