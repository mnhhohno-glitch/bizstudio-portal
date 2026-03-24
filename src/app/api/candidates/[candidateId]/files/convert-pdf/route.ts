import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { google } from "googleapis";
import { Readable } from "stream";
import PizZip from "pizzip";

type RouteContext = { params: Promise<{ candidateId: string }> };

function getAuth() {
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!key) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY が未設定です");
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(key),
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
}

async function processFile(
  drive: ReturnType<typeof google.drive>,
  fileId: string,
  targetDate: string,
  candidateId: string,
  userId: string
) {
  // 1. ファイル情報取得
  const fileInfo = await drive.files.get({
    fileId,
    fields: "name, parents, mimeType",
    supportsAllDrives: true,
  });
  const originalName = fileInfo.data.name!;
  const parentFolderId = fileInfo.data.parents?.[0];

  if (!originalName.toLowerCase().endsWith(".docx")) {
    return { skipped: true, originalName, reason: "docxファイルではありません" };
  }

  // 2. Google Driveからdocxダウンロード
  const response = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  const docxBuffer = Buffer.from(response.data as ArrayBuffer);

  // 3. pizzipで日付書き換え
  const zip = new PizZip(docxBuffer);
  const documentXml = zip.file("word/document.xml");
  if (documentXml) {
    let content = documentXml.asText();
    const d = new Date(targetDate + "T00:00:00");
    const newDateStr = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    content = content.replace(/\d{4}年\d{1,2}月\d{1,2}日/g, newDateStr);
    zip.file("word/document.xml", content);
  }
  const updatedDocx = zip.generate({ type: "nodebuffer" });

  // 4. pdf-text-extractorでPDF変換
  const PDF_EXTRACTOR_URL =
    process.env.PDF_EXTRACTOR_URL || "http://pdf-text-extractor.railway.internal:8080";

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(updatedDocx)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  formData.append("file", blob, originalName);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let pdfResponse: Response;
  try {
    pdfResponse = await fetch(`${PDF_EXTRACTOR_URL}/convert-pdf`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!pdfResponse.ok) {
    const errorText = await pdfResponse.text();
    throw new Error(`PDF変換に失敗: ${errorText}`);
  }

  const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
  const pdfName = originalName.replace(/\.docx$/i, ".pdf");

  // 5. 同名の既存PDFを削除（Google Drive + DB）
  if (parentFolderId) {
    const existingFiles = await drive.files.list({
      q: `name = '${pdfName.replace(/'/g, "\\'")}' and '${parentFolderId}' in parents and trashed = false`,
      fields: "files(id)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    if (existingFiles.data.files) {
      for (const existing of existingFiles.data.files) {
        await drive.files.delete({
          fileId: existing.id!,
          supportsAllDrives: true,
        }).catch(() => {});
        // DB上の対応レコードも削除
        await prisma.candidateFile.deleteMany({
          where: { driveFileId: existing.id! },
        });
      }
    }
  }

  // 6. PDFをGoogle Driveに保存
  const pdfUpload = await drive.files.create({
    requestBody: {
      name: pdfName,
      parents: parentFolderId ? [parentFolderId] : undefined,
    },
    media: {
      mimeType: "application/pdf",
      body: Readable.from(pdfBuffer),
    },
    supportsAllDrives: true,
    fields: "id, name, size, webViewLink",
  });

  const newPdfId = pdfUpload.data.id!;

  // 公開読み取り権限
  await drive.permissions.create({
    fileId: newPdfId,
    requestBody: { role: "reader", type: "anyone" },
    supportsAllDrives: true,
  });

  const pdfInfo = await drive.files.get({
    fileId: newPdfId,
    fields: "webViewLink",
    supportsAllDrives: true,
  });

  const webViewLink =
    pdfInfo.data.webViewLink ||
    `https://drive.google.com/file/d/${newPdfId}/view`;

  // 7. DBにCandidateFileレコード作成
  await prisma.candidateFile.create({
    data: {
      candidateId,
      category: "BS_DOCUMENT",
      fileName: pdfName,
      fileSize: pdfBuffer.length,
      mimeType: "application/pdf",
      driveFileId: newPdfId,
      driveViewUrl: webViewLink,
      driveFolderId: parentFolderId || null,
      memo: "PDF自動変換",
      uploadedByUserId: userId,
    },
  });

  return {
    skipped: false,
    originalName,
    pdfName,
    pdfFileId: newPdfId,
    pdfSize: pdfBuffer.length,
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId } = await context.params;
  const body = await request.json();
  const { fileIds, date } = body;

  if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
    return NextResponse.json({ error: "ファイルを選択してください" }, { status: 400 });
  }
  if (!date || isNaN(new Date(date).getTime())) {
    return NextResponse.json({ error: "有効な日付を指定してください" }, { status: 400 });
  }

  const auth = getAuth();
  const drive = google.drive({ version: "v3", auth });

  const results: Array<{
    originalName: string;
    pdfName?: string;
    pdfFileId?: string;
    pdfSize?: number;
    skipped?: boolean;
    reason?: string;
    error?: string;
  }> = [];

  for (const fid of fileIds) {
    try {
      const result = await processFile(drive, fid, date, candidateId, user.id);
      results.push(result);
    } catch (err) {
      results.push({
        originalName: fid,
        error: err instanceof Error ? err.message : "不明なエラー",
      });
    }
  }

  const created = results.filter((r) => !r.skipped && !r.error).length;

  return NextResponse.json({
    results,
    message: `${created}件のPDFを作成しました`,
  });
}
