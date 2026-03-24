import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { hashToken } from "@/lib/encryption";
import { uploadFileToDrive, getOrCreateFolder } from "@/lib/google-drive";
import { handleCorsOptions, withCors } from "@/lib/cors";
import { CandidateFileCategory } from "@prisma/client";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".jpg", ".jpeg", ".png", ".webp",
]);

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsOptions(request);
  return response || new NextResponse(null, { status: 204 });
}

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

export async function POST(
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

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const category = formData.get("category") as string | null;
  const memo = formData.get("memo") as string | null;

  if (!file || !category) {
    return withCors(NextResponse.json({ error: "ファイルとカテゴリは必須です" }, { status: 400 }), origin);
  }

  // バリデーション
  if (file.size > MAX_FILE_SIZE) {
    return withCors(NextResponse.json({ error: "ファイルサイズは20MB以内にしてください" }, { status: 400 }), origin);
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return withCors(NextResponse.json({ error: "許可されていないファイル形式です" }, { status: 400 }), origin);
  }

  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return withCors(NextResponse.json({ error: "許可されていないファイル拡張子です" }, { status: 400 }), origin);
  }

  const validCategories = Object.values(CandidateFileCategory);
  if (!validCategories.includes(category as CandidateFileCategory)) {
    return withCors(NextResponse.json({ error: "無効なカテゴリです" }, { status: 400 }), origin);
  }

  try {
    const parentFolderId = process.env.GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID;
    if (!parentFolderId) {
      return withCors(NextResponse.json({ error: "GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID が未設定です" }, { status: 500 }), origin);
    }

    // 求職者フォルダを取得or作成
    const candidateFolderId = await getOrCreateFolder(candidateId, parentFolderId);

    // アップロード
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const { fileId, webViewLink } = await uploadFileToDrive(
      file.name,
      fileBuffer,
      candidateFolderId,
      file.type
    );

    // DB保存
    const record = await prisma.candidateFile.create({
      data: {
        candidateId,
        category: category as CandidateFileCategory,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        driveFileId: fileId,
        driveViewUrl: webViewLink,
        driveFolderId: candidateFolderId,
        memo: memo?.trim() || null,
        uploadedByUserId: userId,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });

    return withCors(
      NextResponse.json({ file: record }, { status: 201 }),
      origin
    );
  } catch (e) {
    console.error("File upload error:", e);
    return withCors(
      NextResponse.json({ error: "ファイルアップロードに失敗しました" }, { status: 500 }),
      origin
    );
  }
}
