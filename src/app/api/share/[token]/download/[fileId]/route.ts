import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { downloadFileFromDrive } from "@/lib/google-drive";
import jwt from "jsonwebtoken";

// T-147 ついで対応: フォールバック文字列を削除（既知文字列でJWTを偽造できてしまうため）。
// PORTAL_SSO_SECRET 未設定は fail-closed（本番・staging とも設定済みを確認済み）。
function getShareSecret(): string {
  const secret = process.env.PORTAL_SSO_SECRET;
  if (!secret) throw new Error("PORTAL_SSO_SECRET is not set");
  return secret;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; fileId: string }> }
) {
  const { token, fileId } = await params;

  // Verify access token from cookie
  const accessToken = req.cookies.get(`share_${token}`)?.value;
  if (!accessToken) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  try {
    const payload = jwt.verify(accessToken, getShareSecret()) as { shareToken: string; fileIds: string };
    if (payload.shareToken !== token) {
      return NextResponse.json({ error: "無効なトークンです" }, { status: 403 });
    }

    // Check fileId is in the allowed list
    const allowedIds = payload.fileIds.split(",");
    if (!allowedIds.includes(fileId)) {
      return NextResponse.json({ error: "このファイルへのアクセス権がありません" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "認証の有効期限が切れています" }, { status: 401 });
  }

  // Verify link is still active
  const link = await prisma.fileShareLink.findUnique({ where: { token } });
  if (!link || !link.isActive || new Date() > link.expiresAt) {
    return NextResponse.json({ error: "このリンクは無効です" }, { status: 410 });
  }

  // Get file from DB
  const file = await prisma.candidateFile.findUnique({
    where: { id: fileId },
    select: { driveFileId: true, fileName: true, mimeType: true },
  });

  if (!file || !file.driveFileId) {
    return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
  }

  // Download from Google Drive
  const { base64, mimeType } = await downloadFileFromDrive(file.driveFileId);
  const buffer = Buffer.from(base64, "base64");

  // Increment download count
  await prisma.fileShareLink.update({
    where: { token },
    data: { downloadCount: { increment: 1 } },
  });

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": mimeType || file.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
      "Content-Length": String(buffer.length),
    },
  });
}
