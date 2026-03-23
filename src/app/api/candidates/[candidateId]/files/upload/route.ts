import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { uploadFileToDrive, getOrCreateFolder } from "@/lib/google-drive";
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const category = formData.get("category") as string | null;
  const memo = formData.get("memo") as string | null;

  if (!file || !category) {
    return NextResponse.json({ error: "ファイルとカテゴリは必須です" }, { status: 400 });
  }

  // バリデーション
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "ファイルサイズは20MB以内にしてください" }, { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: "許可されていないファイル形式です" }, { status: 400 });
  }

  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: "許可されていないファイル拡張子です" }, { status: 400 });
  }

  const validCategories = Object.values(CandidateFileCategory);
  if (!validCategories.includes(category as CandidateFileCategory)) {
    return NextResponse.json({ error: "無効なカテゴリです" }, { status: 400 });
  }

  try {
    const parentFolderId = process.env.GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID;
    if (!parentFolderId) {
      return NextResponse.json({ error: "GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID が未設定です" }, { status: 500 });
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
        uploadedByUserId: actor.id,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });

    return NextResponse.json({ file: record }, { status: 201 });
  } catch (e) {
    console.error("File upload error:", e);
    return NextResponse.json({ error: "ファイルアップロードに失敗しました" }, { status: 500 });
  }
}
