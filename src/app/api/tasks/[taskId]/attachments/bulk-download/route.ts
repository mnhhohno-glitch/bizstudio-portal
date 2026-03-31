import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import archiver from "archiver";
import { PassThrough } from "stream";

export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { taskId } = await params;
  const { attachmentIds } = (await req.json()) as { attachmentIds: string[] };

  if (!attachmentIds?.length) {
    return NextResponse.json({ error: "attachmentIds is required" }, { status: 400 });
  }

  const attachments = await prisma.taskAttachment.findMany({
    where: { id: { in: attachmentIds }, taskId },
  });

  if (attachments.length === 0) {
    return NextResponse.json({ error: "No attachments found" }, { status: 404 });
  }

  // Single file: direct download
  if (attachments.length === 1) {
    const att = attachments[0];
    const res = await fetch(att.publicUrl);
    if (!res.ok) return NextResponse.json({ error: "Download failed" }, { status: 502 });
    const buffer = Buffer.from(await res.arrayBuffer());
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": att.mimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(att.fileName)}"`,
      },
    });
  }

  // Multiple files: ZIP
  const passthrough = new PassThrough();
  const archive = archiver("zip", { zlib: { level: 5 } });
  archive.pipe(passthrough);

  for (const att of attachments) {
    try {
      const res = await fetch(att.publicUrl);
      if (!res.ok) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      archive.append(buffer, { name: att.fileName });
    } catch (e) {
      console.error(`[BulkDownload] Failed: ${att.fileName}`, e);
    }
  }

  await archive.finalize();

  const chunks: Buffer[] = [];
  for await (const chunk of passthrough) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const zipBuffer = Buffer.concat(chunks);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  return new NextResponse(zipBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="task_files_${date}.zip"`,
    },
  });
}
