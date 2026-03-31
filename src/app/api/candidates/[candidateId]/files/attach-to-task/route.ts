import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { getSupabase } from "@/lib/supabase";

export const maxDuration = 300;

const BUCKET = "task-attachments";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const { fileIds, taskId } = (await req.json()) as {
    fileIds: string[];
    taskId: string;
  };

  if (!fileIds?.length || !taskId) {
    return NextResponse.json({ error: "fileIds and taskId are required" }, { status: 400 });
  }

  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const files = await prisma.candidateFile.findMany({
    where: { id: { in: fileIds }, candidateId },
    select: { id: true, driveFileId: true, fileName: true, fileSize: true, mimeType: true },
  });

  if (files.length === 0) {
    return NextResponse.json({ error: "No files found" }, { status: 404 });
  }

  const supabase = getSupabase();
  let attached = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const { base64 } = await downloadFileFromDrive(file.driveFileId);
      const buffer = Buffer.from(base64, "base64");

      const ext = file.fileName.split(".").pop() || "bin";
      const storagePath = `${taskId}/${file.id}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
          contentType: file.mimeType,
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(storagePath);

      await prisma.taskAttachment.create({
        data: {
          taskId,
          fileName: file.fileName,
          fileSize: file.fileSize,
          mimeType: file.mimeType,
          storagePath,
          publicUrl: urlData.publicUrl,
          uploadedByUserId: user.id,
        },
      });

      attached++;
    } catch (e) {
      console.error(`[AttachToTask] Failed for ${file.fileName}:`, e);
      failed++;
    }
  }

  return NextResponse.json({
    attached,
    failed,
    message: `${attached}件のファイルをタスクに添付しました`,
  });
}
