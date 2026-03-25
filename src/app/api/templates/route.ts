import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getSessionUser } from "@/lib/auth";

function getAuth() {
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY が設定されていません");
  }
  const credentials = JSON.parse(serviceAccountKey);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}

export async function GET() {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const folderId = process.env.GOOGLE_DRIVE_TEMPLATE_FOLDER_ID;
  if (!folderId) {
    return NextResponse.json({ error: "GOOGLE_DRIVE_TEMPLATE_FOLDER_ID が未設定です" }, { status: 500 });
  }

  try {
    const auth = getAuth();
    const drive = google.drive({ version: "v3", auth });

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, size, createdTime, modifiedTime)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      orderBy: "name",
    });

    return NextResponse.json({ files: response.data.files || [] });
  } catch (e) {
    console.error("Template list error:", e);
    return NextResponse.json({ error: "テンプレート一覧の取得に失敗しました" }, { status: 500 });
  }
}
