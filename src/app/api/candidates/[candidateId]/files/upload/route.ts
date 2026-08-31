import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { hashToken } from "@/lib/encryption";
import { uploadFileToDrive, getOrCreateFolder, convertDocxToPdf } from "@/lib/google-drive";
import { handleCorsOptions, withCors } from "@/lib/cors";
import { CandidateFileCategory } from "@prisma/client";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";
import { enqueueOneDriveSync, triggerOneDriveSync } from "@/lib/onedrive-sync";

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
  "image/gif",
  "image/webp",
  "text/plain",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".txt",
]);

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsOptions(request);
  return response || new NextResponse(null, { status: 204 });
}

async function resolveUserId(req: NextRequest): Promise<string | null> {
  console.log("[Upload] resolveUserId called");

  // 1. Cookie-based session
  const sessionUser = await getSessionUser();
  console.log("[Upload] Cookie auth result:", sessionUser?.id);
  if (sessionUser) return sessionUser.id;

  // 2. Bearer token (AppSession for external apps)
  const authHeader = req.headers.get("authorization");
  console.log("[Upload] Auth header:", authHeader?.substring(0, 20));
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const sessionTokenHash = hashToken(token);
    const appSession = await prisma.appSession.findFirst({
      where: { sessionTokenHash },
    });
    console.log("[Upload] Token lookup result:", appSession ? "found" : "not found");
    console.log("[Upload] Token expires:", appSession?.expiresAt);
    if (appSession && appSession.expiresAt > new Date()) {
      console.log("[Upload] Resolved userId:", appSession.userId);
      return appSession.userId;
    }
  }

  console.log("[Upload] Resolved userId:", null);
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const origin = req.headers.get("origin");
  const userId = await resolveUserId(req);
  if (!userId) {
    console.log("[Upload] Returning 403 - userId is null");
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
  const folderIdRaw = formData.get("folderId") as string | null;
  // T-152: 面談画面の専用アップロード欄からのみ渡される任意パラメータ。
  // 渡された場合のみ「この面談のログ」として紐付ける。既存の添付タブ経由は従来どおり null。
  const interviewIdRaw = formData.get("interviewId") as string | null;

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

  // BS作成書類のみフォルダ指定を許可。それ以外のカテゴリでは folderId は無視（ルート直下扱い）
  let folderId: string | null = null;
  if (category === "BS_DOCUMENT" && folderIdRaw && folderIdRaw.trim()) {
    const folder = await prisma.bSDocumentFolder.findFirst({
      where: { id: folderIdRaw.trim(), candidateId },
      select: { id: true },
    });
    if (!folder) {
      return withCors(NextResponse.json({ error: "指定されたフォルダが見つかりません" }, { status: 400 }), origin);
    }
    folderId = folder.id;
  }

  // T-152: interviewId が渡された場合は「この求職者の実在する面談」であることを検証する。
  // 他求職者の面談IDを紐付ける事故を防ぐため candidateId 一致も条件に含める。
  let interviewId: string | null = null;
  if (interviewIdRaw && interviewIdRaw.trim()) {
    const interview = await prisma.interviewRecord.findFirst({
      where: { id: interviewIdRaw.trim(), candidateId },
      select: { id: true },
    });
    if (!interview) {
      return withCors(NextResponse.json({ error: "指定された面談が見つかりません" }, { status: 400 }), origin);
    }
    interviewId = interview.id;
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
    // T-159: CandidateFile の作成と OneDrive 同期の受付（PENDING 行）を同一トランザクションにする。
    //        「onedrive_sync_logs に行が無い＝そもそも受け付けていない」を保証するため。
    const { record, enqueued } = await prisma.$transaction(async (tx) => {
      const created = await tx.candidateFile.create({
        data: {
          candidateId,
          category: category as CandidateFileCategory,
          folderId,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          driveFileId: fileId,
          driveViewUrl: webViewLink,
          driveFolderId: candidateFolderId,
          memo: memo?.trim() || null,
          interviewId,
          uploadedByUserId: userId,
        },
        include: { uploadedBy: { select: { id: true, name: true } } },
      });
      const accepted = await enqueueOneDriveSync(
        { candidateFileId: created.id, candidateId, category: created.category },
        tx,
      );
      return { record: created, enqueued: accepted };
    });

    // DOCX→PDF自動変換は無効化（品質問題のため）
    // 復活させる場合は以下のコメントを解除:
    // const isDocx =
    //   file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    //   file.name.toLowerCase().endsWith(".docx");
    // if (isDocx) {
    //   try {
    //     const pdfFileName = file.name.replace(/\.docx$/i, ".pdf");
    //     const pdfResult = await convertDocxToPdf({ driveFileId: fileId, pdfFileName, folderId: candidateFolderId });
    //     await prisma.candidateFile.create({ data: { candidateId, category, fileName: pdfFileName, fileSize: pdfResult.fileSize, mimeType: "application/pdf", driveFileId: pdfResult.fileId, driveViewUrl: pdfResult.webViewLink, driveFolderId: candidateFolderId, memo: ((memo?.trim() || "") + "（PDF自動変換）").replace(/^（/, "（"), uploadedByUserId: userId } });
    //   } catch (pdfError) { console.error("[Upload] PDF conversion failed:", pdfError); }
    // }

    if (record.category === "BOOKMARK") {
      try {
        await recalculateSubStatusIfAuto(candidateId);
      } catch (e) {
        console.error("[files.upload] recalculateSubStatusIfAuto failed:", e);
      }
    }

    // T-159: OneDrive へのコピーを起動する。★await しない（レスポンスを待たせない・失敗を波及させない）。
    //        アップロード直後は本体が手元にあるので Google Drive から取り直さず渡す。
    //        triggerOneDriveSync は void を返し、内部で catch 済みのため例外は出ない＝500 に化けない。
    if (enqueued) {
      triggerOneDriveSync({ candidateFileId: record.id, content: fileBuffer, mimeType: file.type });
    }

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
