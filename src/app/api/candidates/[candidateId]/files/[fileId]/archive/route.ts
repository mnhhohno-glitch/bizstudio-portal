import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";

const ALLOWED_REASONS = [
  "重複",
  "希望条件不一致",
  "応募条件不足",
  "求職者意向",
  "選考終了",
  "その他",
] as const;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string; fileId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { candidateId, fileId } = await params;
  const body = await req.json().catch(() => ({}));
  const { reason, note } = body as { reason?: string | null; note?: string | null };

  if (reason && !ALLOWED_REASONS.includes(reason as (typeof ALLOWED_REASONS)[number])) {
    return NextResponse.json({ error: "invalid reason" }, { status: 400 });
  }

  const file = await prisma.candidateFile.findFirst({
    where: { id: fileId, candidateId },
  });
  if (!file) {
    return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
  }
  if (file.category !== "BOOKMARK") {
    return NextResponse.json({ error: "BOOKMARK のみ保留可能です" }, { status: 400 });
  }
  if (file.archivedAt) {
    return NextResponse.json({ error: "既に保留中です" }, { status: 400 });
  }

  const updated = await prisma.candidateFile.update({
    where: { id: file.id },
    data: {
      archivedAt: new Date(),
      archivedReason: reason || null,
      archivedNote: note || null,
      archivedById: user.id,
    },
    include: { archivedBy: { select: { id: true, name: true } } },
  });

  await writeAudit({
    actorUserId: user.id,
    action: "BOOKMARK_ARCHIVE",
    targetType: "CANDIDATE",
    targetId: file.id,
    metadata: {
      candidateId,
      fileName: file.fileName,
      reason: reason || null,
      note: note || null,
    },
  }).catch((e) => console.error("[BookmarkArchive] audit failed:", e));

  try {
    await recalculateSubStatusIfAuto(candidateId);
  } catch (e) {
    console.error("[BookmarkArchive] recalculateSubStatusIfAuto failed:", e);
  }

  return NextResponse.json({ ok: true, file: updated });
}
