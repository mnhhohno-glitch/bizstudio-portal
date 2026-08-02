import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { uploadFileToDrive } from "@/lib/google-drive";

// T-156: お知らせへのPDF添付（admin 限定）。
// Drive へは makePublic=false でアップロードし、公開権限（anyone reader）を付与しない。
// 添付PDFには求職者情報が写り込む前提のため、閲覧は必ず view API のセッション認証経由。

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB（/api/manuals/upload-pdf と同じ）

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  // middleware は /api/ を素通しするため、admin 判定はこのルートで行う（漏れ禁止）
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  const announcement = await prisma.announcement.findUnique({
    where: { id },
    select: { id: true, title: true },
  });
  if (!announcement) {
    return NextResponse.json({ error: "お知らせが見つかりません" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "ファイルが必要です" }, { status: 400 });
  }

  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "PDFファイルのみアップロード可能です" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "ファイルサイズは20MB以下にしてください" }, { status: 400 });
  }

  try {
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    // Drive 上の物理名は衝突しないタイムスタンプ名にし、表示用の元ファイル名は DB に保持する
    const driveFileName = `announcement_${Date.now()}.pdf`;

    const { fileId } = await uploadFileToDrive(
      driveFileName,
      fileBuffer,
      undefined,
      "application/pdf",
      false // 公開権限を付けない
    );

    // sortOrder = 同一お知らせ内の既存最大値+1
    const agg = await prisma.announcementAttachment.aggregate({
      where: { announcementId: id },
      _max: { sortOrder: true },
    });

    const attachment = await prisma.announcementAttachment.create({
      data: {
        announcementId: id,
        fileName: file.name,
        driveFileId: fileId,
        mimeType: "application/pdf",
        fileSize: file.size,
        sortOrder: (agg._max.sortOrder ?? -1) + 1,
        createdByUserId: actor.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: "ANNOUNCEMENT_ATTACHMENT_CREATE",
        targetType: "ANNOUNCEMENT",
        targetId: id,
        metadata: { title: announcement.title, fileName: attachment.fileName, attachmentId: attachment.id },
      },
    });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    console.error("Announcement attachment upload failed:", error);
    return NextResponse.json(
      { error: "添付ファイルのアップロードに失敗しました" },
      { status: 500 }
    );
  }
}
