// T-206: 面接対策ページ 1 件の詳細（GET: 行＋版の一覧）と、項目の変更（PATCH: title / stage / entryId / interviewDate）
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, parseInterviewDate, parseOptionalString, parseStage, requireActor } from "@/lib/mensetsu/internal-api";
import { PAGE_INCLUDE, loadPageById, toPageRow, toVersionRows } from "@/lib/mensetsu/service";

type Ctx = { params: Promise<{ pageId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const guard = await requireActor();
  if (guard.res) return guard.res;
  const { pageId } = await ctx.params;
  const page = await loadPageById(pageId);
  if (!page) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ page: toPageRow(page), versions: toVersionRows(page) });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const guard = await requireActor();
  if (guard.res) return guard.res;
  const { pageId } = await ctx.params;
  const page = await prisma.interviewPrepPage.findUnique({ where: { id: pageId }, select: { id: true, candidateId: true } });
  if (!page) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("invalid_json");
  }

  const data: { title?: string; stage?: string; entryId?: string | null; interviewDate?: Date | null } = {};

  if (body.title !== undefined) {
    const t = parseOptionalString(body.title);
    if (!t) return badRequest("title_required", "タイトルを入力してください");
    data.title = t;
  }
  if (body.stage !== undefined) {
    const s = parseStage(body.stage);
    if (!s) return badRequest("stage_invalid", "種別が不正です");
    data.stage = s;
  }
  if (body.entryId !== undefined) {
    if (body.entryId === null || body.entryId === "") {
      data.entryId = null;
    } else if (typeof body.entryId === "string") {
      const entry = await prisma.jobEntry.findFirst({ where: { id: body.entryId, candidateId: page.candidateId }, select: { id: true } });
      if (!entry) return badRequest("entry_invalid", "この求職者のエントリーではありません");
      data.entryId = entry.id;
    } else {
      return badRequest("entry_invalid");
    }
  }
  const dateCheck = parseInterviewDate(body.interviewDate);
  if (!dateCheck.ok) return badRequest("interview_date_invalid", "面接日の形式が不正です");
  if (dateCheck.value !== undefined) data.interviewDate = dateCheck.value;

  const updated = await prisma.interviewPrepPage.update({ where: { id: pageId }, data, include: PAGE_INCLUDE });
  return NextResponse.json({ page: toPageRow(updated) });
}
