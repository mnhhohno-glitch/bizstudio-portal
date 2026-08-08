import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { downloadFileFromDrive } from "@/lib/google-drive";
import jwt from "jsonwebtoken";
import archiver from "archiver";
import { PassThrough } from "stream";

// T-147 ついで対応: フォールバック文字列を削除（既知文字列でJWTを偽造できてしまうため）。
// PORTAL_SSO_SECRET 未設定は fail-closed（本番・staging とも設定済みを確認済み）。
function getShareSecret(): string {
  const secret = process.env.PORTAL_SSO_SECRET;
  if (!secret) throw new Error("PORTAL_SSO_SECRET is not set");
  return secret;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const accessToken = req.cookies.get(`share_${token}`)?.value;
  if (!accessToken) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  let fileIds: string[];
  try {
    const payload = jwt.verify(accessToken, getShareSecret()) as {
      shareToken: string;
      fileIds: string;
    };
    if (payload.shareToken !== token) {
      return NextResponse.json(
        { error: "無効なトークンです" },
        { status: 403 }
      );
    }
    fileIds = payload.fileIds.split(",");
  } catch {
    return NextResponse.json(
      { error: "認証の有効期限が切れています" },
      { status: 401 }
    );
  }

  const link = await prisma.fileShareLink.findUnique({ where: { token } });
  if (!link || !link.isActive || new Date() > link.expiresAt) {
    return NextResponse.json(
      { error: "このリンクは無効です" },
      { status: 410 }
    );
  }

  const files = await prisma.candidateFile.findMany({
    where: { id: { in: fileIds } },
    select: { driveFileId: true, fileName: true, mimeType: true },
  });

  if (files.length === 0) {
    return NextResponse.json(
      { error: "ファイルが見つかりません" },
      { status: 404 }
    );
  }

  const passthrough = new PassThrough();
  const archive = archiver("zip", { zlib: { level: 5 } });
  archive.pipe(passthrough);

  const downloadPromise = (async () => {
    for (const file of files) {
      if (!file.driveFileId) continue; // PDF実体が無い行はzipに含めない
      const { base64 } = await downloadFileFromDrive(file.driveFileId);
      const buffer = Buffer.from(base64, "base64");
      archive.append(buffer, { name: file.fileName });
    }
    await archive.finalize();
  })();

  const stream = new ReadableStream({
    start(controller) {
      passthrough.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      passthrough.on("end", () => controller.close());
      passthrough.on("error", (err) => controller.error(err));
    },
  });

  downloadPromise.catch((err) => {
    console.error("ZIP archive failed:", err);
    passthrough.destroy(err);
  });

  await prisma.fileShareLink.update({
    where: { token },
    data: { downloadCount: { increment: files.length } },
  });

  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="documents-${dateStr}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
