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

  // T-189 修正: 自動配信行（autoSourcedAt 非null）は「紹介保留」＝「却下」と同一に扱う。
  // 保留と同時に approvalStatus=REJECTED・rejectedReason=保留理由（＋メモ）へ同期し、承認待ちから外す。
  // 受け口 from-job-platform の冪等判定は自動配信行なら archivedAt を問わないので、保留後も同じ求人は再送されない。
  const isAuto = file.autoSourcedAt !== null;
  const syncedRejectedReason = isAuto
    ? [reason || "紹介保留", note ? `（${note}）` : ""].join("")
    : null;
  const updated = await prisma.candidateFile.update({
    where: { id: file.id },
    data: {
      archivedAt: new Date(),
      archivedReason: reason || null,
      archivedNote: note || null,
      archivedById: user.id,
      ...(isAuto ? { approvalStatus: "REJECTED", rejectedReason: syncedRejectedReason } : {}),
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
      autoRecommendSynced: isAuto ? { approvalStatus: "REJECTED", rejectedReason: syncedRejectedReason } : null,
    },
  }).catch((e) => console.error("[BookmarkArchive] audit failed:", e));

  try {
    await recalculateSubStatusIfAuto(candidateId);
  } catch (e) {
    console.error("[BookmarkArchive] recalculateSubStatusIfAuto failed:", e);
  }

  return NextResponse.json({ ok: true, file: updated });
}
