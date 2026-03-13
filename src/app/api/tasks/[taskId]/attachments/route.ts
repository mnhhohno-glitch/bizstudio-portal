import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { randomUUID } from "crypto";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
];
const BUCKET = "task-attachments";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  try {
    const { taskId } = await params;
    const attachments = await prisma.taskAttachment.findMany({
      where: { taskId },
      orderBy: { createdAt: "desc" },
      include: {
        uploadedByUser: { select: { name: true } },
      },
    });
    return NextResponse.json({ attachments });
  } catch {
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  try {
    const { taskId } = await params;

    // タスク存在チェック + 認可
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { assignees: { select: { employeeId: true } } },
    });
    if (!task) {
      return NextResponse.json({ error: "タスクが見つかりません" }, { status: 404 });
    }

    const isCreator = task.createdByUserId === actor.id;
    const isAdmin = actor.role === "admin";
    const employee = await prisma.employee.findFirst({
      where: { name: actor.name, status: "active" },
    });
    const isAssignee = employee
      ? task.assignees.some((a) => a.employeeId === employee.id)
      : false;

    if (!isCreator && !isAdmin && !isAssignee) {
      return NextResponse.json({ error: "アップロード権限がありません" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "ファイルが必要です" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "ファイルサイズが10MBを超えています" }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "許可されていないファイル形式です" }, { status: 400 });
    }

    // Supabase Storageにアップロード
    const fileId = randomUUID();
    const storagePath = `${taskId}/${fileId}_${file.name}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      return NextResponse.json({ error: "ファイルのアップロードに失敗しました" }, { status: 500 });
    }

    // public URL取得
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    // DBに保存
    const attachment = await prisma.taskAttachment.create({
      data: {
        taskId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        storagePath,
        publicUrl: urlData.publicUrl,
        uploadedByUserId: actor.id,
      },
      include: {
        uploadedByUser: { select: { name: true } },
      },
    });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    console.error("Failed to upload attachment:", error);
    return NextResponse.json({ error: "アップロードに失敗しました" }, { status: 500 });
  }
}
