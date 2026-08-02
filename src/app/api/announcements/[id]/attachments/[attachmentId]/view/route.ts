import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { downloadFileFromDrive } from "@/lib/google-drive";

// T-156: お知らせ添付PDFのセッション認証付きインライン配信。
// Drive のファイルには公開権限が無いため、この API がログイン済みユーザーへの唯一の閲覧経路。
// driveViewUrl 等の Drive URL はクライアントに一切返さない。

type RouteContext = { params: Promise<{ id: string; attachmentId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  // ログイン済みであれば閲覧可（CA・バックオフィス全員が対象。admin 限定にしない）
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id, attachmentId } = await context.params;

  const attachment = await prisma.announcementAttachment.findFirst({
    where: { id: attachmentId, announcementId: id },
    include: { announcement: { select: { status: true } } },
  });
  if (!attachment) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // 下書き（未公開）お知らせの添付は admin のみ（一般向けAPIが PUBLISHED しか返さないのと整合）
  if (attachment.announcement.status !== "PUBLISHED" && actor.role !== "admin") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const { base64 } = await downloadFileFromDrive(attachment.driveFileId);
    const buffer = Buffer.from(base64, "base64");

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Announcement attachment download failed:", error);
    return NextResponse.json({ error: "ファイルの取得に失敗しました" }, { status: 500 });
  }
}
