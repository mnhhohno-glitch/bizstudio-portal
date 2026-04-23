import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  uploadFileToDrive,
  deletePdfFromDrive,
  convertDocxToPdf,
} from "@/lib/google-drive";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string; fileId: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { candidateId, fileId } = await params;

  const existing = await prisma.candidateFile.findFirst({
    where: { id: fileId, candidateId },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "ファイルが見つかりません" },
      { status: 404 },
    );
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json(
      { error: "ファイルは必須です" },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "ファイルサイズは20MB以内にしてください" },
      { status: 400 },
    );
  }

  if (
    file.type !== DOCX_MIME &&
    !file.name.toLowerCase().endsWith(".docx")
  ) {
    return NextResponse.json(
      { error: ".docxファイルを選択してください" },
      { status: 400 },
    );
  }

  try {
    const folderId = existing.driveFolderId;
    if (!folderId) {
      return NextResponse.json(
        { error: "アップロード先フォルダが不明です" },
        { status: 500 },
      );
    }

    // 1. 古い docx を Google Drive から削除
    await deletePdfFromDrive(existing.driveFileId);

    // 2. 新しい docx をアップロード
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const { fileId: newDriveId, webViewLink } = await uploadFileToDrive(
      existing.fileName,
      fileBuffer,
      folderId,
      DOCX_MIME,
    );

    // 3. DB レコード更新
    const updated = await prisma.candidateFile.update({
      where: { id: fileId },
      data: {
        fileSize: file.size,
        driveFileId: newDriveId,
        driveViewUrl: webViewLink,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });

    // 4. 同じベース名の PDF を探して再生成
    let pdfUpdated = false;
    const baseName = existing.fileName.replace(/\.docx$/i, "");
    const pdfRecord = await prisma.candidateFile.findFirst({
      where: {
        candidateId,
        fileName: `${baseName}.pdf`,
        id: { not: fileId },
      },
    });

    try {
      const pdfResult = await convertDocxToPdf({
        driveFileId: newDriveId,
        pdfFileName: `${baseName}.pdf`,
        folderId,
      });

      if (pdfRecord) {
        await deletePdfFromDrive(pdfRecord.driveFileId);
        await prisma.candidateFile.update({
          where: { id: pdfRecord.id },
          data: {
            fileSize: pdfResult.fileSize,
            driveFileId: pdfResult.fileId,
            driveViewUrl: pdfResult.webViewLink,
          },
        });
      } else {
        await prisma.candidateFile.create({
          data: {
            candidateId,
            category: existing.category,
            fileName: `${baseName}.pdf`,
            fileSize: pdfResult.fileSize,
            mimeType: "application/pdf",
            driveFileId: pdfResult.fileId,
            driveViewUrl: pdfResult.webViewLink,
            driveFolderId: folderId,
            memo: "Word編集後のPDF自動変換",
            uploadedByUserId: user.id,
          },
        });
      }
      pdfUpdated = true;
    } catch (pdfErr) {
      console.error("[replace-docx] PDF conversion failed:", pdfErr);
    }

    return NextResponse.json({
      success: true,
      file: updated,
      pdfUpdated,
    });
  } catch (e) {
    console.error("[replace-docx] Error:", e);
    return NextResponse.json(
      { error: "ファイルの置き換えに失敗しました" },
      { status: 500 },
    );
  }
}
