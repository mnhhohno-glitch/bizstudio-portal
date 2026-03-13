import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { uploadPdfToDrive } from "@/lib/google-drive";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "ファイルが必要です" }, { status: 400 });
  }

  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "PDFファイルのみアップロード可能です" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "ファイルサイズは20MB以下にしてください" }, { status: 400 });
  }

  try {
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const fileName = `manual_${Date.now()}.pdf`;

    const { fileId, webViewLink } = await uploadPdfToDrive(fileName, fileBuffer);

    return NextResponse.json({
      driveFileId: fileId,
      driveViewUrl: webViewLink,
    });
  } catch (error) {
    console.error("PDF upload to Google Drive failed:", error);
    return NextResponse.json(
      { error: "Google Driveへのアップロードに失敗しました" },
      { status: 500 }
    );
  }
}
