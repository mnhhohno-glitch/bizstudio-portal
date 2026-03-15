import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { ManualCategory, ManualContentType } from "@prisma/client";

const VALID_CATEGORIES: ManualCategory[] = ["INTERNAL", "CANDIDATE", "CLIENT"];
const VALID_CONTENT_TYPES: ManualContentType[] = ["VIDEO", "PDF", "URL", "MARKDOWN"];

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json();
  const { title, category, subCategory, contentType, videoUrl, pdfPath, pdfData, driveFileId, driveViewUrl, externalUrl, markdownContent, description } = body;

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "タイトルは必須です" }, { status: 400 });
  }

  if (!category || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "カテゴリが無効です" }, { status: 400 });
  }

  if (!contentType || !VALID_CONTENT_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "コンテンツタイプが無効です" }, { status: 400 });
  }

  if (contentType === "VIDEO") {
    if (!videoUrl || typeof videoUrl !== "string") {
      return NextResponse.json({ error: "動画URLは必須です" }, { status: 400 });
    }
    if (!videoUrl.startsWith("https://")) {
      return NextResponse.json({ error: "動画URLはhttps://で始まる必要があります" }, { status: 400 });
    }
  }

  if (contentType === "PDF" && !driveFileId && !pdfData) {
    return NextResponse.json({ error: "PDFデータは必須です" }, { status: 400 });
  }

  if (contentType === "URL") {
    if (!externalUrl || typeof externalUrl !== "string") {
      return NextResponse.json({ error: "外部URLは必須です" }, { status: 400 });
    }
  }

  if (contentType === "MARKDOWN") {
    if (!markdownContent || typeof markdownContent !== "string") {
      return NextResponse.json({ error: "Markdownコンテンツは必須です" }, { status: 400 });
    }
  }

  const manual = await prisma.manual.create({
    data: {
      title: title.trim(),
      category,
      subCategory: subCategory?.trim() || null,
      contentType,
      videoUrl: videoUrl?.trim() || null,
      pdfPath: pdfPath?.trim() || null,
      pdfData: driveFileId ? null : (pdfData || null),
      driveFileId: driveFileId || null,
      driveViewUrl: driveViewUrl || null,
      externalUrl: externalUrl?.trim() || null,
      markdownContent: markdownContent || null,
      description: description?.trim() || null,
      authorUserId: user.id,
    },
    include: {
      author: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(manual);
}
