import { google } from "googleapis";
import { Readable } from "stream";

function getAuth() {
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY が設定されていません");
  }

  const credentials = JSON.parse(serviceAccountKey);

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
}

/**
 * Google Drive にファイルをアップロード（汎用）
 */
export async function uploadFileToDrive(
  fileName: string,
  fileBuffer: Buffer,
  folderId?: string,
  mimeType: string = "application/pdf"
): Promise<{ fileId: string; webViewLink: string }> {
  const auth = getAuth();
  const drive = google.drive({ version: "v3", auth });

  const targetFolderId = folderId || process.env.GOOGLE_DRIVE_MANUAL_FOLDER_ID;
  if (!targetFolderId) {
    throw new Error("アップロード先フォルダが指定されていません");
  }

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [targetFolderId],
    },
    media: {
      mimeType,
      body: Readable.from(fileBuffer),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });

  const fileId = response.data.id!;

  await drive.permissions.create({
    fileId,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
    supportsAllDrives: true,
  });

  const fileInfo = await drive.files.get({
    fileId,
    fields: "webViewLink, webContentLink",
    supportsAllDrives: true,
  });

  return {
    fileId,
    webViewLink:
      fileInfo.data.webViewLink ||
      `https://drive.google.com/file/d/${fileId}/view`,
  };
}

/** 後方互換: PDF専用アップロード */
export async function uploadPdfToDrive(
  fileName: string,
  fileBuffer: Buffer
): Promise<{ fileId: string; webViewLink: string }> {
  return uploadFileToDrive(fileName, fileBuffer);
}

/**
 * 指定した親フォルダ内に子フォルダを作成（または既存のものを取得）
 */
export async function getOrCreateFolder(
  folderName: string,
  parentFolderId: string
): Promise<string> {
  const auth = getAuth();
  const drive = google.drive({ version: "v3", auth });

  const searchResponse = await drive.files.list({
    q: `name='${folderName.replace(/'/g, "\\'")}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (searchResponse.data.files && searchResponse.data.files.length > 0) {
    return searchResponse.data.files[0].id!;
  }

  const createResponse = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    },
    fields: "id",
    supportsAllDrives: true,
  });

  return createResponse.data.id!;
}

/**
 * Google Driveからファイルの中身をダウンロード（Base64）
 */
export async function downloadFileFromDrive(
  fileId: string
): Promise<{ base64: string; mimeType: string }> {
  const auth = getAuth();
  const drive = google.drive({ version: "v3", auth });

  const metaResponse = await drive.files.get({
    fileId,
    fields: "mimeType",
    supportsAllDrives: true,
  });
  const mimeType = metaResponse.data.mimeType || "application/octet-stream";

  const contentResponse = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );

  const buffer = Buffer.from(contentResponse.data as ArrayBuffer);
  const base64 = buffer.toString("base64");

  return { base64, mimeType };
}

export async function deletePdfFromDrive(fileId: string): Promise<void> {
  const auth = getAuth();
  const drive = google.drive({ version: "v3", auth });

  try {
    await drive.files.delete({ fileId, supportsAllDrives: true });
  } catch (error) {
    console.error("Google Drive ファイル削除エラー:", error);
  }
}
