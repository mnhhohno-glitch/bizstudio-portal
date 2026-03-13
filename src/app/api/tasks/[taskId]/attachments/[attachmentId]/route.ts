import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const BUCKET = "task-attachments";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ taskId: string; attachmentId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  try {
    const { taskId, attachmentId } = await params;

    const attachment = await prisma.taskAttachment.findFirst({
      where: { id: attachmentId, taskId },
    });
    if (!attachment) {
      return NextResponse.json({ error: "添付ファイルが見つかりません" }, { status: 404 });
    }

    // アップロードした本人 or admin のみ削除可能
    if (attachment.uploadedByUserId !== actor.id && actor.role !== "admin") {
      return NextResponse.json({ error: "削除権限がありません" }, { status: 403 });
    }

    // Supabase Storageから削除
    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .remove([attachment.storagePath]);

    if (storageError) {
      console.error("Supabase delete error:", storageError);
    }

    // DBから削除
    await prisma.taskAttachment.delete({ where: { id: attachmentId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete attachment:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
