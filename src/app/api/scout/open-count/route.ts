/**
 * POST /api/scout/open-count
 *   body: { date: "YYYY-MM-DD", updates: [{ id, openCount }] }
 *   開封数を一括保存
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  try {
    const body = await req.json();
    const updates = Array.isArray(body?.updates) ? body.updates : [];

    let successCount = 0;
    let failureCount = 0;
    for (const u of updates) {
      if (!u?.id) {
        failureCount++;
        continue;
      }
      try {
        await prisma.scoutDeliverySlot.update({
          where: { id: String(u.id) },
          data: {
            openCount: parseInt(String(u.openCount ?? 0), 10) || 0,
            updatedById: user.id,
          },
        });
        successCount++;
      } catch {
        failureCount++;
      }
    }
    return NextResponse.json({ successCount, failureCount });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
