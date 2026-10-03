// T-206: 差し替え（版を 1 つ足す）。URL・公開期限・閲覧記録・本人確認済みの端末は変えない。
//   body { html, note?, publish?: boolean }  publish=true かつ下書きなら続けて公開する（「差し替えて公開」）
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isEntryClosed } from "@/lib/mensetsu/constants";
import { expiresAtFrom } from "@/lib/mensetsu/dates";
import { badRequest, parseOptionalString, requireActor, validateHtml } from "@/lib/mensetsu/internal-api";
import { PAGE_INCLUDE, appendVersion, loadPageById, todayYmd, toPageRow } from "@/lib/mensetsu/service";

type Ctx = { params: Promise<{ pageId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requireActor();
  if (guard.res) return guard.res;
  const { pageId } = await ctx.params;
  const page = await loadPageById(pageId);
  if (!page) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("invalid_json");
  }
  const htmlCheck = validateHtml(body.html);
  if (!htmlCheck.ok) return htmlCheck.res;

  const versionNo = await appendVersion(pageId, htmlCheck.html, guard.actor.id, parseOptionalString(body.note));

  const now = new Date();
  let publishedNow = false;
  if (body.publish === true && page.status === "draft") {
    if (page.requireBirthdate && !page.candidate.birthday) {
      return badRequest("birthday_missing", "差し替えは保存しましたが、求職者の生年月日が未登録のため公開できません");
    }
    if (isEntryClosed(page.entry)) {
      return badRequest("entry_closed", "差し替えは保存しましたが、ひもづいたエントリーの選考が終了しているため公開できません");
    }
    await prisma.interviewPrepPage.update({
      where: { id: pageId },
      data: { status: "published", publishedAt: now, expiresAt: expiresAtFrom(todayYmd(now)), stoppedAt: null, stoppedReason: null },
    });
    publishedNow = true;
  }

  const updated = await prisma.interviewPrepPage.findUniqueOrThrow({ where: { id: pageId }, include: PAGE_INCLUDE });
  return NextResponse.json({ page: toPageRow(updated, now), versionNo, publishedNow });
}
