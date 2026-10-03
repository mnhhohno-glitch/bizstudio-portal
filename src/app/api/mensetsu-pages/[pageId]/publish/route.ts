// T-206: 公開（下書き → 公開中）。URL が有効になる。
//   - 本人確認あり（requireBirthdate）で求職者の生年月日が未登録なら公開できない（400 birthday_missing）
//   - ひもづいたエントリーが選考終了なら公開できない（400 entry_closed。ひもづけを外せば公開できる）
//   - publishedAt=今、expiresAt=今日（JST）＋30日の 0:00 JST
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
  if (page.status !== "draft") return badRequest("not_draft", "下書きではありません（停止中の記録は「再公開」を使ってください）");
  if (page.requireBirthdate && !page.candidate.birthday) {
    return badRequest("birthday_missing", "求職者の生年月日が未登録のため公開できません。基本情報で生年月日を登録してください");
  }
  if (isEntryClosed(page.entry)) {
    return badRequest("entry_closed", "ひもづいたエントリーの選考が終了しているため公開できません。別のエントリーに付け替えるか、ひもづけを外してください");
  }
  if (page.versions.length === 0) return badRequest("no_version", "HTML がアップロードされていません");

  const now = new Date();
  const updated = await prisma.interviewPrepPage.update({
    where: { id: pageId },
    data: { status: "published", publishedAt: now, expiresAt: expiresAtFrom(todayYmd(now)), stoppedAt: null, stoppedReason: null },
    include: PAGE_INCLUDE,
  });
  return NextResponse.json({ page: toPageRow(updated, now) });
}
