// T-206: プレビュー用 HTML（公開時と同じ最終形）。
//   GET  ?version=N … 保存済みの版（省略時は現在の版）
//   POST { html }   … まだ保存していない HTML（差し替え前の確認用。保存はしない）
//   ポータルの中で iframe srcdoc に入れて表示する。公開 URL を通さないので閲覧数には数えない。
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, requireActor, validateHtml } from "@/lib/mensetsu/internal-api";
import { loadPageById } from "@/lib/mensetsu/service";
import { wrapMensetsuHtml } from "@/lib/mensetsu/wrapper";

type Ctx = { params: Promise<{ pageId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requireActor();
  if (guard.res) return guard.res;
  const { pageId } = await ctx.params;
  const page = await loadPageById(pageId);
  if (!page) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const versionParam = req.nextUrl.searchParams.get("version");
  const versionNo = versionParam ? Number(versionParam) : null;
  const version = await prisma.interviewPrepPageVersion.findFirst({
    where: versionNo && Number.isInteger(versionNo) ? { pageId, versionNo } : { pageId },
    orderBy: { versionNo: "desc" },
    select: { versionNo: true, html: true },
  });
  if (!version) return NextResponse.json({ error: "version_not_found" }, { status: 404 });

  const html = page.useWrapper ? wrapMensetsuHtml(version.html, { candidateName: page.candidate.name }) : version.html;
  return NextResponse.json({ versionNo: version.versionNo, useWrapper: page.useWrapper, html });
}

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

  const html = page.useWrapper ? wrapMensetsuHtml(htmlCheck.html, { candidateName: page.candidate.name }) : htmlCheck.html;
  return NextResponse.json({ versionNo: null, useWrapper: page.useWrapper, html });
}
