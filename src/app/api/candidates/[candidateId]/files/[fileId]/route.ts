import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { hashToken } from "@/lib/encryption";
import { deletePdfFromDrive, downloadFileFromDrive } from "@/lib/google-drive";
import { getCorsHeaders, handleCorsOptions, withCors } from "@/lib/cors";

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
  { params }: { params: Promise<{ candidateId: string; fileId: string }> }
) {
  const origin = req.headers.get("origin");
  const userId = await resolveUserId(req);
  if (!userId) {
    return withCors(
      NextResponse.json({ error: "forbidden" }, { status: 403 }),
      origin
    );
  }

  const { candidateId, fileId } = await params;

  const file = await prisma.candidateFile.findFirst({
    where: { id: fileId, candidateId },
    include: { uploadedBy: { select: { id: true, name: true } } },
  });

  if (!file) {
    return withCors(
      NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 }),
      origin
    );
  }

  const { searchParams } = new URL(req.url);
  if (searchParams.get("download") === "true") {
    try {
      const { base64, mimeType } = await downloadFileFromDrive(file.driveFileId);
      const buffer = Buffer.from(base64, "base64");

      const encodedFileName = encodeURIComponent(file.fileName);
      const response = new NextResponse(buffer, {
        headers: {
          "Content-Type": mimeType,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodedFileName}`,
          "Content-Length": String(buffer.length),
        },
      });
      const corsHeaders = getCorsHeaders(origin);
      for (const [key, value] of Object.entries(corsHeaders)) {
        response.headers.set(key, value);
      }
      return response;
    } catch (e) {
      console.error("File download error:", e);
      return withCors(
        NextResponse.json({ error: "ファイルのダウンロードに失敗しました" }, { status: 500 }),
        origin
      );
    }
  }

  return withCors(NextResponse.json({ file }), origin);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string; fileId: string }> }
) {
  const origin = req.headers.get("origin");
  const userId = await resolveUserId(req);
  if (!userId) {
    return withCors(
      NextResponse.json({ error: "forbidden" }, { status: 403 }),
      origin
    );
  }

  const { fileId } = await params;

  const file = await prisma.candidateFile.findUnique({ where: { id: fileId } });
  if (!file) {
    return withCors(
      NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 }),
      origin
    );
  }

  // Google Driveから削除
  await deletePdfFromDrive(file.driveFileId);

  // DBから削除
  await prisma.candidateFile.delete({ where: { id: fileId } });

  return withCors(NextResponse.json({ success: true }), origin);
}
