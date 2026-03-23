import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { deletePdfFromDrive } from "@/lib/google-drive";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string; fileId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { fileId } = await params;

  const file = await prisma.candidateFile.findUnique({ where: { id: fileId } });
  if (!file) {
    return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
  }

  // Google Driveから削除
  await deletePdfFromDrive(file.driveFileId);

  // DBから削除
  await prisma.candidateFile.delete({ where: { id: fileId } });

  return NextResponse.json({ success: true });
}
