// T-206: 版の一覧（各版のプレビューは /preview?version=N）。古い版へ戻す機能は持たない。
import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/mensetsu/internal-api";
import { loadPageById, toVersionRows } from "@/lib/mensetsu/service";

type Ctx = { params: Promise<{ pageId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const guard = await requireActor();
  if (guard.res) return guard.res;
  const { pageId } = await ctx.params;
  const page = await loadPageById(pageId);
  if (!page) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ versions: toVersionRows(page) });
}
