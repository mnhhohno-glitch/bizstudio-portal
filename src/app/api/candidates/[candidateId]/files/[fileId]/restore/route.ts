import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";

export async function POST(
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
    return NextResponse.json({ error: "保留中ではありません" }, { status: 400 });
  }

  const updated = await prisma.candidateFile.update({
    where: { id: file.id },
    data: {
      archivedAt: null,
      archivedReason: null,
      archivedNote: null,
      archivedById: null,
    },
  });

  await writeAudit({
    actorUserId: user.id,
    action: "BOOKMARK_RESTORE",
    targetType: "CANDIDATE",
    targetId: file.id,
    metadata: {
      candidateId,
      fileName: file.fileName,
    },
  }).catch((e) => console.error("[BookmarkRestore] audit failed:", e));

  try {
    await recalculateSubStatusIfAuto(candidateId);
  } catch (e) {
    console.error("[BookmarkRestore] recalculateSubStatusIfAuto failed:", e);
  }

  return NextResponse.json({ ok: true, file: updated });
}
