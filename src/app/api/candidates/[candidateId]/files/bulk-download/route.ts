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

  // Create ZIP using archiver
  const passthrough = new PassThrough();
  const archive = archiver("zip", { zlib: { level: 5 } });
  archive.pipe(passthrough);

  // Download files and add to archive
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

  // Collect all chunks into a buffer
  const chunks: Buffer[] = [];
  for await (const chunk of passthrough) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const zipBuffer = Buffer.concat(chunks);

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  return new NextResponse(zipBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="bookmarks_${date}.zip"`,
      "Content-Length": String(zipBuffer.length),
    },
  });
}
