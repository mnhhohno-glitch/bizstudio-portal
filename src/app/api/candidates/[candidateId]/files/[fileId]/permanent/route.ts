import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { deletePdfFromDrive } from "@/lib/google-drive";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ candidateId: string; fileId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { candidateId, fileId } = await params;

  const file = await prisma.candidateFile.findFirst({
    where: { id: fileId, candidateId },
  });
  if (!file) {
    return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
  }
  if (!file.archivedAt) {
    return NextResponse.json(
      { error: "紹介保留中のファイルのみ完全削除可能です" },
      { status: 400 }
    );
  }

  if (file.driveFileId) {
    try {
      await deletePdfFromDrive(file.driveFileId);
    } catch (e) {
      console.error("[BookmarkPermanentDelete] Drive delete failed:", e);
    }
  }

  await prisma.candidateFile.delete({ where: { id: file.id } });

  await writeAudit({
    actorUserId: user.id,
    action: "BOOKMARK_PERMANENT_DELETE",
    targetType: "CANDIDATE",
    targetId: file.id,
    metadata: {
      candidateId,
      fileName: file.fileName,
      archivedReason: file.archivedReason,
      archivedNote: file.archivedNote,
    },
  }).catch((e) => console.error("[BookmarkPermanentDelete] audit failed:", e));

  try {
    await recalculateSubStatusIfAuto(candidateId);
  } catch (e) {
    console.error("[BookmarkPermanentDelete] recalculateSubStatusIfAuto failed:", e);
  }

  return NextResponse.json({ ok: true });
}
