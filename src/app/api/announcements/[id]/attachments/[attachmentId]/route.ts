import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { deletePdfFromDrive } from "@/lib/google-drive";

// T-156: お知らせ添付の削除（admin 限定）。
// DBレコード削除を先に完了させ、Drive 側の削除失敗は致命扱いにしない
// （deletePdfFromDrive は内部で例外を握り潰してログに残す）。

type RouteContext = { params: Promise<{ id: string; attachmentId: string }> };

export async function DELETE(_request: NextRequest, context: RouteContext) {
  // middleware は /api/ を素通しするため、admin 判定はこのルートで行う（漏れ禁止）
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id, attachmentId } = await context.params;

  const attachment = await prisma.announcementAttachment.findFirst({
    where: { id: attachmentId, announcementId: id },
  });
  if (!attachment) {
    return NextResponse.json({ error: "添付ファイルが見つかりません" }, { status: 404 });
  }

  await prisma.announcementAttachment.delete({ where: { id: attachmentId } });

  // Drive 側の削除。失敗してもDB削除は完了済み（エラーは deletePdfFromDrive 内でログ出力）
  await deletePdfFromDrive(attachment.driveFileId);

  await prisma.auditLog.create({
    data: {
      actorUserId: actor.id,
      action: "ANNOUNCEMENT_ATTACHMENT_DELETE",
      targetType: "ANNOUNCEMENT",
      targetId: id,
      metadata: { fileName: attachment.fileName, attachmentId },
    },
  });

  return NextResponse.json({ success: true });
}
