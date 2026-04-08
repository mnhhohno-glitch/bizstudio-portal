import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { downloadFileFromDrive } from "@/lib/google-drive";
import archiver from "archiver";
import { PassThrough } from "stream";

export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const { fileIds } = (await req.json()) as { fileIds: string[] };

  if (!fileIds?.length) {
    return NextResponse.json({ error: "fileIds is required" }, { status: 400 });
  }

  const files = await prisma.candidateFile.findMany({
    where: { id: { in: fileIds }, candidateId },
    select: { driveFileId: true, fileName: true },
  });

  if (files.length === 0) {
    return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
  }

  // Single file: direct download without zipping
  if (files.length === 1) {
    try {
      const { base64, mimeType } = await downloadFileFromDrive(files[0].driveFileId);
      const buffer = Buffer.from(base64, "base64");
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": mimeType,
          "Content-Disposition": `attachment; filename="${encodeURIComponent(files[0].fileName)}"`,
        },
      });
    } catch {
      return NextResponse.json({ error: "ダウンロードに失敗しました" }, { status: 502 });
    }
  }

  // Multiple files: stream ZIP response
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const stream = new ReadableStream({
    async start(controller) {
      const passthrough = new PassThrough();
      const archive = archiver("zip", { zlib: { level: 5 } });
      archive.pipe(passthrough);

      passthrough.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      passthrough.on("end", () => {
        controller.close();
      });
      passthrough.on("error", (err) => {
        console.error("[BulkDownload] Stream error:", err);
        controller.error(err);
      });

      for (const file of files) {
        try {
          const { base64 } = await downloadFileFromDrive(file.driveFileId);
          const buffer = Buffer.from(base64, "base64");
          archive.append(buffer, { name: file.fileName });
        } catch (e) {
          console.error(`[BulkDownload] Failed to download ${file.fileName}:`, e);
        }
      }

      await archive.finalize();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="bookmarks_${date}.zip"`,
    },
  });
}
