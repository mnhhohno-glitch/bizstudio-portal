import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { hashToken } from "@/lib/encryption";
import { handleCorsOptions, withCors } from "@/lib/cors";
import { Prisma } from "@prisma/client";

async function resolveUserId(req: NextRequest): Promise<string | null> {
  // 1. Cookie-based session
  const sessionUser = await getSessionUser();
  if (sessionUser) return sessionUser.id;

  // 2. Bearer token (AppSession for external apps)
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const sessionTokenHash = hashToken(token);
    const appSession = await prisma.appSession.findFirst({
      where: { sessionTokenHash },
    });
    if (appSession && appSession.expiresAt > new Date()) {
      return appSession.userId;
    }
  }

  return null;
}

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsOptions(request);
  return response || new NextResponse(null, { status: 204 });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const origin = req.headers.get("origin");
  const userId = await resolveUserId(req);
  if (!userId) {
    return withCors(
      NextResponse.json({ error: "forbidden" }, { status: 403 }),
      origin
    );
  }

  const { candidateId } = await params;
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const archivedParam = searchParams.get("archived");

  const where: Prisma.CandidateFileWhereInput = { candidateId };
  if (category) {
    where.category = category as Prisma.EnumCandidateFileCategoryFilter;
  }
  if (archivedParam === "true") {
    where.archivedAt = { not: null };
  } else if (archivedParam === "all") {
    // no filter on archivedAt
  } else {
    where.archivedAt = null;
  }

  const files = await prisma.candidateFile.findMany({
    where,
    orderBy: archivedParam === "true"
      ? { archivedAt: "desc" }
      : { createdAt: "desc" },
    select: {
      id: true,
      candidateId: true,
      category: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      driveFileId: true,
      driveViewUrl: true,
      driveFolderId: true,
      folderId: true,
      memo: true,
      candidateNote: true,
      caComment: true,
      // T-128 Phase2-1: HistoryTab のエントリー作成で jobDb/externalJobNo を正値化するために使用。
      sourceType: true,
      externalJobRef: true,
      sourceMedia: true,
      // 求職者本人のサイト操作由来（"candidate"）か CA追加（null|"ca"）かの区別。担当列の「サイト経由」表示に使う。
      origin: true,
      // T-133 FU: 求職者本人のマイページ回答。CA画面の「本人回答」列で表示（読むだけ・書き込みしない）。
      responseStatus: true,
      uploadedByUserId: true,
      createdAt: true,
      updatedAt: true,
      extractedAt: true,
      aiMatchRating: true,
      aiAnalysisComment: true,
      aiAnalyzedAt: true,
      lastExportedAt: true,
      lastExportedTo: true,
      archivedAt: true,
      archivedReason: true,
      archivedNote: true,
      archivedById: true,
      uploadedBy: { select: { id: true, name: true } },
      archivedBy: { select: { id: true, name: true } },
    },
  });

  return withCors(NextResponse.json({ files }), origin);
}
