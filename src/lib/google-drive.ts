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
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
}

export async function uploadPdfToDrive(
  fileName: string,
  fileBuffer: Buffer
): Promise<{ fileId: string; webViewLink: string }> {
  const auth = getAuth();
  const drive = google.drive({ version: "v3", auth });

  const folderId = process.env.GOOGLE_DRIVE_MANUAL_FOLDER_ID;
  if (!folderId) {
    throw new Error("GOOGLE_DRIVE_MANUAL_FOLDER_ID が設定されていません");
  }

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: "application/pdf",
      body: Readable.from(fileBuffer),
    },
    fields: "id, webViewLink",
  });

  const fileId = response.data.id!;

  await drive.permissions.create({
    fileId,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });

  const fileInfo = await drive.files.get({
    fileId,
    fields: "webViewLink, webContentLink",
  });

  return {
    fileId,
    webViewLink:
      fileInfo.data.webViewLink ||
      `https://drive.google.com/file/d/${fileId}/view`,
  };
}

export async function deletePdfFromDrive(fileId: string): Promise<void> {
  const auth = getAuth();
  const drive = google.drive({ version: "v3", auth });

  try {
    await drive.files.delete({ fileId });
  } catch (error) {
    console.error("Google Drive ファイル削除エラー:", error);
  }
}
