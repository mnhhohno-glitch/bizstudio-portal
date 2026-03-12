import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { ManualCategory, ManualContentType } from "@prisma/client";

const VALID_CATEGORIES: ManualCategory[] = ["INTERNAL", "CANDIDATE", "CLIENT"];
const VALID_CONTENT_TYPES: ManualContentType[] = ["VIDEO", "PDF", "URL", "MARKDOWN"];

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(_request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { id } = await context.params;

  const existing = await prisma.manual.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "マニュアルが見つかりません" }, { status: 404 });
  }

  if (user.role !== "admin" && existing.authorUserId !== user.id) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const body = await _request.json();
  const { title, category, contentType, videoUrl, pdfPath, externalUrl, markdownContent, description } = body;

  if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "カテゴリが無効です" }, { status: 400 });
  }

  if (contentType !== undefined && !VALID_CONTENT_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "コンテンツタイプが無効です" }, { status: 400 });
  }

  const effectiveContentType = contentType ?? existing.contentType;

  if (effectiveContentType === "VIDEO" && videoUrl !== undefined) {
    if (typeof videoUrl !== "string" || !videoUrl.startsWith("https://www.loom.com/")) {
      return NextResponse.json({ error: "動画URLはLoomのURLである必要があります" }, { status: 400 });
    }
  }

  const data: Record<string, unknown> = {};
  if (title !== undefined) data.title = title.trim();
  if (category !== undefined) data.category = category;
  if (contentType !== undefined) data.contentType = contentType;
  if (videoUrl !== undefined) data.videoUrl = videoUrl?.trim() || null;
  if (pdfPath !== undefined) data.pdfPath = pdfPath?.trim() || null;
  if (externalUrl !== undefined) data.externalUrl = externalUrl?.trim() || null;
  if (markdownContent !== undefined) data.markdownContent = markdownContent || null;
  if (description !== undefined) data.description = description?.trim() || null;

  const manual = await prisma.manual.update({
    where: { id },
    data,
    include: {
      author: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(manual);
}
