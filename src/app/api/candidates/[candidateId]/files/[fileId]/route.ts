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

function toMatchLabel(rating: string | null): string {
  switch (rating) {
    case "A": return "◎ 非常にマッチ";
    case "B": return "○ マッチ";
    case "C":
    case "D": return "△ チャレンジ求人";
    default: return "";
  }
}

export async function PATCH(
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
  const body = await req.json();
  const { aiAnalysisComment } = body as { aiAnalysisComment?: string };

  if (typeof aiAnalysisComment !== "string") {
    return withCors(
      NextResponse.json({ error: "aiAnalysisComment is required" }, { status: 400 }),
      origin
    );
  }

  // 1. DB保存
  const file = await prisma.candidateFile.update({
    where: { id: fileId },
    data: { aiAnalysisComment },
  });

  if (file.candidateId !== candidateId) {
    return withCors(
      NextResponse.json({ error: "candidate mismatch" }, { status: 400 }),
      origin
    );
  }

  // 2. kyuujinPDFに再送信（マイページ反映） — 失敗してもDB保存は成功扱い
  try {
    const KYUUJIN_PDF_TOOL_URL = process.env.KYUUJIN_PDF_TOOL_URL;
    const KYUUJIN_API_SECRET = process.env.KYUUJIN_API_SECRET;
    if (KYUUJIN_PDF_TOOL_URL && KYUUJIN_API_SECRET) {
      const jobNumMatch = file.fileName.match(/_No(\d+)/i);
      if (jobNumMatch) {
        const candidate = await prisma.candidate.findUnique({
          where: { id: candidateId },
          select: { candidateNumber: true },
        });
        if (candidate?.candidateNumber) {
          const commentBody = aiAnalysisComment
            .replace(/■\s*本人希望[：:]\s*[ABCD]\s*/g, "")
            .replace(/■\s*通過率[：:]\s*[ABCD]\s*/g, "")
            .replace(/■\s*総合[：:]\s*[ABCD]\s*/g, "")
            .trim();
          const matchLabel = toMatchLabel(file.aiMatchRating);
          await fetch(`${KYUUJIN_PDF_TOOL_URL}/api/external/mypage/jobs/ca-comment`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "x-api-secret": KYUUJIN_API_SECRET,
            },
            body: JSON.stringify({
              job_seeker_id: candidate.candidateNumber,
              comments: [{
                job_number: jobNumMatch[1],
                match_label: matchLabel,
                comment: commentBody,
              }],
            }),
          });
          console.log(`[FilePatch] CA comment synced to kyuujinPDF: ${file.fileName}`);
        }
      }
    }
  } catch (e) {
    console.error("[FilePatch] kyuujinPDF sync failed:", e);
  }

  return withCors(NextResponse.json({ success: true, file }), origin);
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
