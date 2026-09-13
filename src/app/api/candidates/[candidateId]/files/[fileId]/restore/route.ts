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

  // T-189 修正: 自動配信行（autoSourcedAt 非null）の復元は却下の取り消し＝approvalStatus を PENDING に戻す（承認待ちへ復帰）。
  const isAuto = file.autoSourcedAt !== null;
  const updated = await prisma.candidateFile.update({
    where: { id: file.id },
    data: {
      archivedAt: null,
      archivedReason: null,
      archivedNote: null,
      archivedById: null,
      ...(isAuto ? { approvalStatus: "PENDING", rejectedReason: null } : {}),
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
      autoRecommendSynced: isAuto ? { approvalStatus: "PENDING" } : null,
    },
  }).catch((e) => console.error("[BookmarkRestore] audit failed:", e));

  try {
    await recalculateSubStatusIfAuto(candidateId);
  } catch (e) {
    console.error("[BookmarkRestore] recalculateSubStatusIfAuto failed:", e);
  }

  return NextResponse.json({ ok: true, file: updated });
}
