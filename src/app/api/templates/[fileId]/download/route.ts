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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { fileId } = await params;

  try {
    const auth = getAuth();
    const drive = google.drive({ version: "v3", auth });

    // Get file metadata
    const metaResponse = await drive.files.get({
      fileId,
      fields: "name, mimeType",
      supportsAllDrives: true,
    });
    const fileName = metaResponse.data.name || "download";
    const mimeType = metaResponse.data.mimeType || "application/octet-stream";

    // Download file content
    const contentResponse = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );

    const buffer = Buffer.from(contentResponse.data as ArrayBuffer);
    const encodedFileName = encodeURIComponent(fileName);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodedFileName}`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (e) {
    console.error("Template download error:", e);
    return NextResponse.json({ error: "テンプレートのダウンロードに失敗しました" }, { status: 500 });
  }
}
