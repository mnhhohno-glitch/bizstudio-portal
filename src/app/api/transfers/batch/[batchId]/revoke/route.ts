// T-147 改修: 同一送信操作（batch_id）でまとめて作られた送信の一括無効化。
// 個別無効化（/api/transfers/[id]/revoke）と同じ権限（送信者本人 or admin）。
// revokedAt をセットするだけで受信側は即座に開けなくなる。Storage 実体の削除は cleanup cron に任せる。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { batchId } = await params;

  const transfers = await prisma.secureTransfer.findMany({
    where: { batchId },
    select: { id: true, senderId: true, revokedAt: true, recipientEmail: true },
  });

  if (transfers.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // batch 内は同一送信者（作成APIの仕様）。先頭で代表判定する。
  if (transfers[0].senderId !== user.id && user.role !== "admin") {
    return NextResponse.json(
      { error: "無効化できるのは送信者本人と管理者のみです" },
      { status: 403 }
    );
  }

  const targets = transfers.filter((t) => !t.revokedAt);
  if (targets.length === 0) {
    return NextResponse.json({ error: "既に無効化されています" }, { status: 409 });
  }

  const revokedAt = new Date();
  await prisma.secureTransfer.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: { revokedAt },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: "SECURE_TRANSFER_REVOKE",
      // AuditTargetType は既存 DB enum のため値を足さない（共有DBの既存型変更を避ける）。
      targetType: "SYSTEM",
      targetId: batchId,
      metadata: {
        batchId,
        recipientEmails: targets.map((t) => t.recipientEmail),
        revokedCount: targets.length,
      },
    },
  });

  return NextResponse.json({ revokedAt, revokedCount: targets.length });
}
