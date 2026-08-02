// T-147: セキュアファイル送信の即時無効化。
// 操作できるのは送信者本人と admin のみ（閲覧は全社員可・確定仕様）。
// revokedAt をセットするだけで受信側は即座に開けなくなる。Storage 実体の削除は cleanup cron に任せる。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const transfer = await prisma.secureTransfer.findUnique({
    where: { id },
    select: { id: true, senderId: true, revokedAt: true, recipientEmail: true },
  });

  if (!transfer) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (transfer.senderId !== user.id && user.role !== "admin") {
    return NextResponse.json(
      { error: "無効化できるのは送信者本人と管理者のみです" },
      { status: 403 }
    );
  }
  if (transfer.revokedAt) {
    return NextResponse.json({ error: "既に無効化されています" }, { status: 409 });
  }

  const updated = await prisma.secureTransfer.update({
    where: { id },
    data: { revokedAt: new Date() },
    select: { revokedAt: true },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: "SECURE_TRANSFER_REVOKE",
      // AuditTargetType は既存 DB enum のため値を足さない（共有DBの既存型変更を避ける）。
      targetType: "SYSTEM",
      targetId: id,
      metadata: { recipientEmail: transfer.recipientEmail },
    },
  });

  return NextResponse.json({ revokedAt: updated.revokedAt });
}
