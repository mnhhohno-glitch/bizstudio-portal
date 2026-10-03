// T-206: 面接対策ページ 一覧（GET）・新規作成＝下書き保存（POST）
//   GET  → { candidate: { name, hasBirthday }, entries: [...], pages: PageRow[] }
//   POST { stage, title?, entryId?, interviewDate?, html, note? } → { page: PageRow }
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CLOSABLE_ENTRY_SELECT, isEntryClosed } from "@/lib/mensetsu/constants";
import { badRequest, parseInterviewDate, parseOptionalString, parseStage, requireActor, validateHtml } from "@/lib/mensetsu/internal-api";
import { PAGE_INCLUDE, createPageWithFirstVersion, toPageRow } from "@/lib/mensetsu/service";

type Ctx = { params: Promise<{ candidateId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const guard = await requireActor();
  if (guard.res) return guard.res;
  const { candidateId } = await ctx.params;

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, name: true, birthday: true },
  });
  if (!candidate) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [pages, entries] = await Promise.all([
    prisma.interviewPrepPage.findMany({ where: { candidateId }, include: PAGE_INCLUDE, orderBy: { createdAt: "desc" } }),
    prisma.jobEntry.findMany({
      where: { candidateId },
      select: { ...CLOSABLE_ENTRY_SELECT, firstInterviewDate: true, secondInterviewDate: true, finalInterviewDate: true },
      orderBy: { entryDate: "desc" },
    }),
  ]);

  const now = new Date();
  return NextResponse.json({
    candidate: { id: candidate.id, name: candidate.name, hasBirthday: !!candidate.birthday },
    entries: entries.map((e) => ({
      id: e.id,
      companyName: e.companyName,
      entryFlag: e.entryFlag,
      entryFlagDetail: e.entryFlagDetail,
      closed: isEntryClosed(e),
      // 面接日の初期値の候補（JST 暦日）
      firstInterviewDate: e.firstInterviewDate ? e.firstInterviewDate.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) : null,
      secondInterviewDate: e.secondInterviewDate ? e.secondInterviewDate.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) : null,
      finalInterviewDate: e.finalInterviewDate ? e.finalInterviewDate.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) : null,
    })),
    pages: pages.map((p) => toPageRow(p, now)),
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requireActor();
  if (guard.res) return guard.res;
  const { candidateId } = await ctx.params;

  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true } });
  if (!candidate) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("invalid_json");
  }

  const stage = parseStage(body.stage);
  if (!stage) return badRequest("stage_invalid", "種別を選んでください");

  const htmlCheck = validateHtml(body.html);
  if (!htmlCheck.ok) return htmlCheck.res;

  const dateCheck = parseInterviewDate(body.interviewDate);
  if (!dateCheck.ok) return badRequest("interview_date_invalid", "面接日の形式が不正です");

  let entryId: string | null = null;
  let companyName: string | null = null;
  if (typeof body.entryId === "string" && body.entryId) {
    const entry = await prisma.jobEntry.findFirst({ where: { id: body.entryId, candidateId }, select: { id: true, companyName: true } });
    if (!entry) return badRequest("entry_invalid", "この求職者のエントリーではありません");
    entryId = entry.id;
    companyName = entry.companyName;
  }

  const title = parseOptionalString(body.title) ?? (companyName ? `${stage}対策（${companyName}）` : `${stage}対策`);

  const page = await createPageWithFirstVersion({
    candidateId,
    entryId,
    stage,
    title,
    interviewDate: dateCheck.value ?? null,
    html: htmlCheck.html,
    note: parseOptionalString(body.note),
    createdById: guard.actor.id,
  });

  return NextResponse.json({ page: toPageRow(page) }, { status: 201 });
}
