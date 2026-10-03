// T-206: 再公開（停止 → 公開中）。期限が切れていれば今日（JST）＋30日に張り直す。
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isEntryClosed } from "@/lib/mensetsu/constants";
import { expiresAtFrom } from "@/lib/mensetsu/dates";
import { badRequest, requireActor } from "@/lib/mensetsu/internal-api";
import { PAGE_INCLUDE, loadPageById, todayYmd, toPageRow } from "@/lib/mensetsu/service";

type Ctx = { params: Promise<{ pageId: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const guard = await requireActor();
  if (guard.res) return guard.res;
  const { pageId } = await ctx.params;
  const page = await loadPageById(pageId);
  if (!page) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (page.status !== "stopped") return badRequest("not_stopped", "停止中の記録だけ再公開できます");
  if (page.requireBirthdate && !page.candidate.birthday) {
    return badRequest("birthday_missing", "求職者の生年月日が未登録のため再公開できません");
  }
  if (isEntryClosed(page.entry)) {
    return badRequest("entry_closed", "ひもづいたエントリーの選考が終了しているため再公開できません");
  }

  const now = new Date();
  const expired = !page.expiresAt || page.expiresAt.getTime() <= now.getTime();
  const updated = await prisma.interviewPrepPage.update({
    where: { id: pageId },
    data: {
      status: "published",
      stoppedAt: null,
      stoppedReason: null,
      publishedAt: page.publishedAt ?? now,
      ...(expired ? { expiresAt: expiresAtFrom(todayYmd(now)) } : {}),
    },
    include: PAGE_INCLUDE,
  });
  return NextResponse.json({ page: toPageRow(updated, now) });
}
