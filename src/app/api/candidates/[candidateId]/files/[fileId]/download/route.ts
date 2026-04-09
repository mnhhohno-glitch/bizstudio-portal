import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { downloadFileFromDrive } from "@/lib/google-drive";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ candidateId: string; fileId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId, fileId } = await params;

  const file = await prisma.candidateFile.findFirst({
    where: { id: fileId, candidateId },
    select: { driveFileId: true, fileName: true, mimeType: true },
  });

  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { base64, mimeType } = await downloadFileFromDrive(file.driveFileId);
  const buffer = Buffer.from(base64, "base64");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": mimeType || file.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
    },
  });
}
